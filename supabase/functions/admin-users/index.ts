/*
  Pinned to an exact patch, not `@2`.

  `@2` is not a version -- it is "whichever 2.x is newest at cold start", so the
  code running in this function could change with no commit in this repo. That
  matters more here than anywhere else in the product: this is the only surface
  holding SUPABASE_SERVICE_ROLE_KEY (which bypasses every RLS policy) and
  CRED_ENC_KEY (which decrypts every stored GS password). A compromised publish
  upstream, or a compromised esm.sh, would execute with both and leave nothing
  in `git log`.

  Kept in step with package.json's @supabase/supabase-js by hand -- the frontend
  and this function talk to the same PostgREST, and a silent split between them
  is its own class of bug.
*/
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3'
import { decryptSecret, encryptSecret, importKey } from './crypto.ts'
import {
  changeRole,
  duplicateNameMessage,
  parseChangeRole,
  safeError,
  USERNAME_PATTERN,
  USERNAME_RULE,
  validateCreate,
  type AccountRow,
  type StaffPorts,
} from './staff.ts'

const AUTH_EMAIL_SUFFIX = '@app.local'

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`admin-users: missing required environment variable ${name}`)
  }
  return value
}

const SUPABASE_URL = requireEnv('SUPABASE_URL')
const SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const CRED_ENC_KEY = requireEnv('CRED_ENC_KEY')

// supabase-js `functions.invoke` sends `authorization`, `apikey`, `x-client-info`
// and `content-type` -- all non-safelisted headers, so every browser call is
// preflighted with an OPTIONS request. Pin the origin rather than `*`: this
// surface reveals passwords, and a wildcard would let any page with a stolen
// token call it cross-origin. Update ADMIN_APP_ORIGIN (an Edge Function
// secret) once the admin app is deployed to a real domain.
const ALLOWED_ORIGIN = Deno.env.get('ADMIN_APP_ORIGIN') ?? 'http://localhost:5173'

const CORS = {
  'access-control-allow-origin': ALLOWED_ORIGIN,
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })

/** service_role client — bypasses RLS. Never returned to the caller. */
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/** Resolves the bearer token to an active admin profile, or null. */
async function callerAdminId(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '')
  if (!token) return null

  const { data: userData } = await admin.auth.getUser(token)
  const uid = userData.user?.id
  if (!uid) return null

  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, active')
    .eq('id', uid)
    .maybeSingle()

  return profile?.role === 'admin' && profile.active ? profile.id : null
}

/**
 * Refuses an action aimed at an admin account (or at no account).
 *
 * `set-password` and `deactivate` used to take any user id at all, so one admin
 * could reset another admin's password -- locking them out of an account that
 * reads every project -- or switch them off entirely. Neither writes to
 * `credential_access_log`; only `reveal` does. So the one operation in this
 * system that is genuinely an escalation between peers was also the only one
 * leaving no trace.
 *
 * A missing profile is refused too, not treated as "not an admin, therefore
 * fine": an id with no profile is either a deleted account or a typo, and
 * neither is something to act on.
 *
 * Since 0028 the managed accounts are GS and viewer, so the check is "not an
 * admin" rather than "is a GS". Returns null when the caller may proceed.
 */
async function refuseAdminTarget(userId: string): Promise<Response | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', userId)
    .maybeSingle()
  if (error) return json({ error: 'Could not read the target account' }, 500)
  if (!data) return json({ error: 'No such account' }, 404)
  if (data.role === 'admin') {
    return json({ error: 'This action is only available for GS and viewer accounts' }, 403)
  }
  return null
}

// MANAGED_ROLES, USERNAME_PATTERN, USERNAME_RULE and safeError live in
// staff.ts since Nhân lực (NL-04), so its unit tests cover them.

/**
 * Locks an account: no new sign-in, and `active = false` so every member
 * policy (all resolve through my_projects / my_works, which require an active
 * profile) stops granting on the spot. Shared by `deactivate` and `hide`.
 *
 * No session revocation here on purpose -- see the comment in the deactivate
 * case for why the earlier attempt to call auth.admin.signOut(userId) was
 * wrong twice over. Memberships are KEPT (Feedback Rv2, item 1d): a lock is
 * reversible now, and an unlocked foreman must find their projects intact.
 */
async function lockAccount(userId: string): Promise<Response | null> {
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: '876000h',
  })
  if (banError) {
    return json({ error: safeError('Không khoá được tài khoản', banError.message) }, 500)
  }
  const { error: profileError } = await admin
    .from('profiles')
    .update({ active: false })
    .eq('id', userId)
  if (profileError) {
    return json({ error: safeError('Không đánh dấu được tài khoản là đã khoá', profileError.message) }, 500)
  }
  return null
}

/**
 * How many reveals one admin may make in an hour.
 *
 * A stolen admin token could otherwise loop `reveal` across the whole GS list
 * and drain every stored password in seconds; `credential_access_log` would
 * record it perfectly and stop none of it. The limit is deliberately well above
 * a working day's legitimate use -- an admin handing out passwords one at a
 * time on the radio never approaches it -- so this costs nobody anything until
 * something is wrong.
 *
 * Counted from the log rather than kept in memory: Edge Functions are
 * per-invocation, so in-memory state would reset on every cold start, which is
 * exactly what an attacker's burst would trigger.
 */
const REVEAL_LIMIT_PER_HOUR = 20

/**
 * Deletes the just-created auth user after a downstream insert fails, so a
 * partial account never lingers. If the delete itself fails, the account is
 * stuck with a confirmed email and a working password but no profile -- and
 * because auth emails are unique, the username is permanently burned until
 * an operator deletes it by hand. Say so explicitly rather than reporting the
 * original (now misleading) insert error.
 */
async function rollbackCreatedUser(userId: string, insertErrorMessage: string): Promise<Response> {
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    return json(
      {
        error: `Account setup failed and cleanup also failed -- auth user ${userId} is orphaned and needs manual deletion`,
      },
      500,
    )
  }
  return json({ error: insertErrorMessage }, 400)
}

const ACCOUNT_COLUMNS = 'id, username, full_name, role, active, hidden'

// deno-lint-ignore no-explicit-any
const toAccount = (row: any): AccountRow => ({
  id: row.id,
  username: row.username,
  fullName: row.full_name,
  role: row.role,
  active: row.active,
  hidden: Boolean(row.hidden),
})

/**
 * `change_role`'s view of the world (staff.ts), on the service_role client.
 * Each write answers with its error or null; the flow and its undo steps are
 * in staff.ts, where they are unit-tested.
 */
function staffPorts(key: CryptoKey): StaffPorts {
  return {
    async readEmployee(id) {
      const { data, error } = await admin.from('employees').select('id, full_name, active').eq('id', id).maybeSingle()
      return { row: data ? { id: data.id, fullName: data.full_name, active: data.active } : null, error }
    },
    async readAccount(id) {
      const { data, error } = await admin.from('profiles').select(ACCOUNT_COLUMNS).eq('id', id).maybeSingle()
      return { row: data ? toAccount(data) : null, error }
    },
    async listHiddenAccounts() {
      const { data, error } = await admin
        .from('profiles')
        .select(ACCOUNT_COLUMNS)
        .eq('hidden', true)
        .in('role', ['gs', 'viewer'])
      return { rows: (data ?? []).map(toAccount), error }
    },
    async createAuthUser(username, password) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `${username}${AUTH_EMAIL_SUFFIX}`,
        password,
        email_confirm: true,
      })
      return { userId: data?.user?.id ?? null, error }
    },
    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      return error
    },
    async setAuthPassword(userId, password) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      return error
    },
    async setBanned(userId, banned) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: banned ? '876000h' : 'none',
      })
      return error
    },
    async insertProfile(row) {
      const { error } = await admin
        .from('profiles')
        .insert({ id: row.id, username: row.username, full_name: row.fullName, role: row.role })
      return error
    },
    async updateProfile(id, patch) {
      const { error } = await admin.from('profiles').update(patch).eq('id', id)
      return error
    },
    async storeCredential(userId, password) {
      const { error } = await admin
        .from('gs_credentials')
        .upsert({ user_id: userId, secret: await encryptSecret(key, password) })
      return error
    },
    async addMembership(userId, projectId) {
      // An existing membership is kept as it is, with its work restriction.
      const { error } = await admin
        .from('project_members')
        .upsert({ project_id: projectId, user_id: userId }, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
      return error
    },
    async insertEmployee(fullName, active) {
      const { data, error } = await admin
        .from('employees')
        .insert({ full_name: fullName, active })
        .select('id')
        .single()
      return { id: data?.id ?? null, error }
    },
    async deleteEmployee(id) {
      const { error } = await admin.from('employees').delete().eq('id', id)
      return error
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const adminId = await callerAdminId(req)
  if (!adminId) return json({ error: 'Forbidden' }, 403)

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    const key = await importKey(CRED_ENC_KEY)

    switch (body.action) {
      case 'create': {
        // Default gs: the app before Feedback Rv2 never sent a role, and a
        // missing field must keep meaning what it always meant. A GS needs a
        // project; a Visitor gets none (NL-05, see validateCreate).
        const checked = validateCreate(body)
        if (!checked.ok) return json({ error: checked.error }, 400)
        const { username, fullName, password, projectId, role } = checked.value

        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: `${username}${AUTH_EMAIL_SUFFIX}`,
          password,
          email_confirm: true,
        })
        if (createError || !created.user) {
          return json({ error: safeError('Không tạo được tài khoản', createError?.message) }, 400)
        }
        const userId = created.user.id

        const { error: profileError } = await admin
          .from('profiles')
          .insert({ id: userId, username, full_name: fullName, role })
        if (profileError) {
          // 0037: the name is already on the Nhân lực list.
          return await rollbackCreatedUser(
            userId,
            duplicateNameMessage(profileError, fullName)
              ?? safeError('Không tạo được hồ sơ người dùng', profileError.message),
          )
        }

        // gs_credentials before project_members: it is the irreplaceable row --
        // the one this whole feature exists to protect. A live account with an
        // unrevealable password (reveal returns 404 forever) is worse than no
        // account, so if this insert fails the account must not survive either.
        const { error: credError } = await admin
          .from('gs_credentials')
          .insert({ user_id: userId, secret: await encryptSecret(key, password) })
        if (credError) {
          return await rollbackCreatedUser(userId, safeError('Không lưu được thông tin đăng nhập', credError.message))
        }

        // A Visitor reads every project since 0034; no membership row (NL-05).
        if (projectId !== null) {
          const { error: memberError } = await admin
            .from('project_members')
            .insert({ project_id: projectId, user_id: userId })
          if (memberError) {
            return await rollbackCreatedUser(userId, safeError('Không gán được dự án cho tài khoản', memberError.message))
          }
        }

        return json({ userId })
      }

      case 'reveal': {
        if (!body.userId) return json({ error: 'userId is required' }, 400)
        const wrongTarget = await refuseAdminTarget(body.userId)
        if (wrongTarget) return wrongTarget

        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        const { count, error: countError } = await admin
          .from('credential_access_log')
          .select('id', { count: 'exact', head: true })
          .eq('admin_id', adminId)
          .gte('at', since)
        // Fail closed, for the same reason the log write below does: an
        // unreadable log means the throttle cannot be enforced, and an
        // unenforceable throttle on this action is no throttle at all.
        if (countError) return json({ error: 'Could not check the access log; reveal aborted' }, 500)
        if ((count ?? 0) >= REVEAL_LIMIT_PER_HOUR) {
          return json(
            { error: 'Too many password reveals in the last hour. Try again later.' },
            429,
          )
        }

        const { data } = await admin
          .from('gs_credentials')
          .select('secret')
          .eq('user_id', body.userId)
          .maybeSingle()
        if (!data) return json({ error: 'No stored credential' }, 404)

        const { error: logError } = await admin
          .from('credential_access_log')
          .insert({ admin_id: adminId, target_user_id: body.userId })
        if (logError) {
          // This log is the only record of who read what -- fail closed. No
          // log, no reveal, rather than silently returning the password anyway.
          return json({ error: 'Could not record credential access; reveal aborted' }, 500)
        }

        return json({ password: await decryptSecret(key, data.secret) })
      }

      case 'set-password': {
        const { userId, password } = body
        if (!userId || !password) return json({ error: 'userId and password are required' }, 400)
        const wrongTarget = await refuseAdminTarget(userId)
        if (wrongTarget) return wrongTarget

        // Ciphertext first, deliberately. If the ciphertext write fails,
        // nothing has changed yet and the supervisor keeps working with
        // their existing password -- the worst case is "nothing happened".
        // If it succeeds and the auth update then fails, restore the saved
        // value below so the stored secret and the real password can never
        // disagree -- the alternative is a supervisor locked out of an
        // account whose password the admin can no longer look up.
        const { data: existing, error: readError } = await admin
          .from('gs_credentials')
          .select('secret')
          .eq('user_id', userId)
          .maybeSingle()
        // A failed read and a genuinely absent row both yield data: null, so the
        // error has to be checked to tell them apart. Guessing "no prior row" here
        // would leave nothing to restore if the auth update below fails, which is
        // the exact divergence this ordering exists to prevent.
        if (readError) return json({ error: safeError('Không đọc được thông tin đăng nhập hiện tại', readError.message) }, 500)
        const previousSecret = existing?.secret ?? null

        const { error: credError } = await admin
          .from('gs_credentials')
          .upsert({ user_id: userId, secret: await encryptSecret(key, password) })
        if (credError) return json({ error: safeError('Không lưu được mật khẩu mới', credError.message) }, 500)

        const { error: authError } = await admin.auth.admin.updateUserById(userId, { password })
        if (authError) {
          if (previousSecret !== null) {
            await admin.from('gs_credentials').upsert({ user_id: userId, secret: previousSecret })
          }
          // else: no prior row (account created before credentials existed,
          // or `create` half-failed) -- nothing to restore to.
          return json({ error: safeError('Không đổi được mật khẩu', authError.message) }, 500)
        }

        return json({ ok: true })
      }

      case 'deactivate': {
        // "Khoá tài khoản" (Feedback Rv2, item 1d). It used to delete the
        // project memberships too, which made the lock permanent in practice;
        // they stay now, and `reactivate` undoes this exactly.
        //
        // No session revocation here on purpose. my_projects() and my_works()
        // require profiles.active, and every member policy resolves through
        // them, so an unexpired access token grants nothing the moment this
        // commits. The ban stops new sign-ins. An earlier attempt to call
        // auth.admin.signOut(userId) was wrong twice over: that API takes a
        // JWT, not a user id, and it made this whole action fail.
        if (!body.userId) return json({ error: 'userId is required' }, 400)
        const wrongTarget = await refuseAdminTarget(body.userId)
        if (wrongTarget) return wrongTarget
        const locked = await lockAccount(body.userId)
        if (locked) return locked
        return json({ ok: true })
      }

      case 'reactivate': {
        if (!body.userId) return json({ error: 'userId is required' }, 400)
        const wrongTarget = await refuseAdminTarget(body.userId)
        if (wrongTarget) return wrongTarget

        const { error: banError } = await admin.auth.admin.updateUserById(body.userId, {
          ban_duration: 'none',
        })
        if (banError) {
          return json({ error: safeError('Không mở khoá được tài khoản', banError.message) }, 500)
        }
        const { error: profileError } = await admin
          .from('profiles')
          .update({ active: true })
          .eq('id', body.userId)
        if (profileError) {
          return json({ error: safeError('Không đánh dấu được tài khoản là đang dùng', profileError.message) }, 500)
        }
        return json({ ok: true })
      }

      case 'rename': {
        // Item 1a. The login name is the auth email's local part AND
        // profiles.username, so both move, auth first: a profile pointing at a
        // name the auth side does not know would lock the account out, while
        // the reverse (auth renamed, profile not) is repaired below.
        const { userId } = body
        const username = (body.username ?? '').trim().toLowerCase()
        if (!userId || !username) return json({ error: 'userId and username are required' }, 400)
        if (!USERNAME_PATTERN.test(username)) return json({ error: USERNAME_RULE }, 400)
        const wrongTarget = await refuseAdminTarget(userId)
        if (wrongTarget) return wrongTarget

        const { data: taken, error: takenError } = await admin
          .from('profiles')
          .select('id')
          .eq('username', username)
          .maybeSingle()
        if (takenError) return json({ error: safeError('Không kiểm tra được tên đăng nhập', takenError.message) }, 500)
        if (taken && taken.id !== userId) return json({ error: 'Tên đăng nhập này đã có người dùng' }, 400)

        const { data: current, error: readError } = await admin
          .from('profiles')
          .select('username')
          .eq('id', userId)
          .single()
        if (readError || !current) return json({ error: safeError('Không đọc được tài khoản', readError?.message) }, 500)
        if (current.username === username) return json({ ok: true })

        const { error: authError } = await admin.auth.admin.updateUserById(userId, {
          email: `${username}${AUTH_EMAIL_SUFFIX}`,
          email_confirm: true,
        })
        if (authError) return json({ error: safeError('Không đổi được tên đăng nhập', authError.message) }, 400)

        const { error: profileError } = await admin
          .from('profiles')
          .update({ username })
          .eq('id', userId)
        if (profileError) {
          // Put the auth side back so the account keeps signing in under the
          // name the admin still sees. If even that fails, say so plainly.
          const { error: revertError } = await admin.auth.admin.updateUserById(userId, {
            email: `${current.username}${AUTH_EMAIL_SUFFIX}`,
            email_confirm: true,
          })
          if (revertError) {
            return json({ error: `Đổi tên thất bại nửa chừng: tài khoản đăng nhập bằng «${username}» nhưng hồ sơ vẫn ghi «${current.username}». Chi tiết đã được ghi vào log máy chủ.` }, 500)
          }
          return json({ error: safeError('Không đổi được tên đăng nhập trên hồ sơ', profileError.message) }, 500)
        }
        return json({ ok: true })
      }

      case 'hide': {
        // Item 1e. Never a delete: cell_events.by and cell_states.updated_by
        // keep naming the person. Hidden implies locked, so the row cannot
        // sign in while it is out of sight.
        if (!body.userId) return json({ error: 'userId is required' }, 400)
        const wrongTarget = await refuseAdminTarget(body.userId)
        if (wrongTarget) return wrongTarget
        const locked = await lockAccount(body.userId)
        if (locked) return locked
        const { error } = await admin.from('profiles').update({ hidden: true }).eq('id', body.userId)
        if (error) return json({ error: safeError('Không ẩn được tài khoản', error.message) }, 500)
        return json({ ok: true })
      }

      case 'unhide': {
        // Back on the list, still locked: unlocking is a separate decision.
        if (!body.userId) return json({ error: 'userId is required' }, 400)
        const wrongTarget = await refuseAdminTarget(body.userId)
        if (wrongTarget) return wrongTarget
        const { error } = await admin.from('profiles').update({ hidden: false }).eq('id', body.userId)
        if (error) {
          // 0037: an employee now carries this name; "Đổi phân quyền" on that
          // employee is what brings the account back.
          if (error.code === 'PPDUP') {
            const { data: target } = await admin.from('profiles').select('full_name').eq('id', body.userId).maybeSingle()
            const named = duplicateNameMessage(error, target?.full_name ?? '')
            if (named) return json({ error: named }, 400)
          }
          return json({ error: safeError('Không hiện lại được tài khoản', error.message) }, 500)
        }
        return json({ ok: true })
      }

      case 'change_role': {
        // NL-04: Nhân viên ↔ GS/Visitor, and GS ↔ Visitor. The flow, its
        // ordering around 0037 and its undo steps: staff.ts changeRole.
        const parsed = parseChangeRole(body)
        if (!parsed.ok) return json({ error: parsed.error }, 400)
        const outcome = await changeRole(staffPorts(key), parsed.value)
        return json(outcome.body, outcome.status)
      }

      default:
        return json({ error: `Unknown action: ${body.action}` }, 400)
    }
  } catch {
    // Anything unexpected -- a tampered/rotated secret failing to decrypt, a
    // malformed CRED_ENC_KEY, a null-shaped body reaching `body.action` -- must
    // never leak its message. These are exactly the paths most likely to carry
    // key material in a future edit, so the response is a fixed generic string.
    return json({ error: 'Internal error' }, 500)
  }
})
