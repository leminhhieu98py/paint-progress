import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptSecret, encryptSecret, importKey } from './crypto.ts'

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
        const { username, fullName, password, projectId } = body
        if (!username || !fullName || !password || !projectId) {
          return json({ error: 'username, fullName, password, projectId are required' }, 400)
        }

        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: `${username.trim().toLowerCase()}${AUTH_EMAIL_SUFFIX}`,
          password,
          email_confirm: true,
        })
        if (createError || !created.user) {
          return json({ error: createError?.message ?? 'Could not create user' }, 400)
        }
        const userId = created.user.id

        const { error: profileError } = await admin
          .from('profiles')
          .insert({ id: userId, username: username.trim().toLowerCase(), full_name: fullName, role: 'gs' })
        if (profileError) {
          return await rollbackCreatedUser(userId, profileError.message)
        }

        // gs_credentials before project_members: it is the irreplaceable row --
        // the one this whole feature exists to protect. A live account with an
        // unrevealable password (reveal returns 404 forever) is worse than no
        // account, so if this insert fails the account must not survive either.
        const { error: credError } = await admin
          .from('gs_credentials')
          .insert({ user_id: userId, secret: await encryptSecret(key, password) })
        if (credError) {
          return await rollbackCreatedUser(userId, credError.message)
        }

        const { error: memberError } = await admin
          .from('project_members')
          .insert({ project_id: projectId, user_id: userId })
        if (memberError) {
          return await rollbackCreatedUser(userId, memberError.message)
        }

        return json({ userId })
      }

      case 'reveal': {
        if (!body.userId) return json({ error: 'userId is required' }, 400)

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

        // Ciphertext first, deliberately. If the ciphertext write fails,
        // nothing has changed yet and the supervisor keeps working with
        // their existing password -- the worst case is "nothing happened".
        // If it succeeds and the auth update then fails, restore the saved
        // value below so the stored secret and the real password can never
        // disagree -- the alternative is a supervisor locked out of an
        // account whose password the admin can no longer look up.
        const { data: existing } = await admin
          .from('gs_credentials')
          .select('secret')
          .eq('user_id', userId)
          .maybeSingle()
        const previousSecret = existing?.secret ?? null

        const { error: credError } = await admin
          .from('gs_credentials')
          .upsert({ user_id: userId, secret: await encryptSecret(key, password) })
        if (credError) return json({ error: credError.message }, 500)

        const { error: authError } = await admin.auth.admin.updateUserById(userId, { password })
        if (authError) {
          if (previousSecret !== null) {
            await admin.from('gs_credentials').upsert({ user_id: userId, secret: previousSecret })
          }
          // else: no prior row (account created before credentials existed,
          // or `create` half-failed) -- nothing to restore to.
          return json({ error: authError.message }, 500)
        }

        return json({ ok: true })
      }

      case 'deactivate': {
        if (!body.userId) return json({ error: 'userId is required' }, 400)
        const userId = body.userId

        const { error: banError } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        })
        if (banError) {
          return json({ error: `Could not ban account: ${banError.message}` }, 500)
        }

        // No session revocation here on purpose. my_projects() requires
        // profiles.active, and every GS read policy plus cells_member_update
        // resolves through it, so an unexpired access token grants nothing the
        // moment this commits. The ban stops new sign-ins. An earlier attempt to
        // call auth.admin.signOut(userId) was wrong twice over: that API takes a
        // JWT, not a user id, and it made this whole action fail.

        const { error: memberError } = await admin.from('project_members').delete().eq('user_id', userId)
        if (memberError) {
          return json({ error: `Could not remove project membership: ${memberError.message}` }, 500)
        }

        const { error: profileError } = await admin
          .from('profiles')
          .update({ active: false })
          .eq('id', userId)
        if (profileError) {
          return json({ error: `Could not mark profile inactive: ${profileError.message}` }, 500)
        }

        return json({ ok: true })
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
