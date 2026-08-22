import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptSecret, encryptSecret, importKey } from './crypto.ts'

const AUTH_EMAIL_SUFFIX = '@app.local'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRED_ENC_KEY = Deno.env.get('CRED_ENC_KEY')!

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const adminId = await callerAdminId(req)
  if (!adminId) return json({ error: 'Forbidden' }, 403)

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

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
        // Roll the auth user back so a failed create leaves nothing behind.
        await admin.auth.admin.deleteUser(userId)
        return json({ error: profileError.message }, 400)
      }

      await admin.from('project_members').insert({ project_id: projectId, user_id: userId })
      await admin
        .from('gs_credentials')
        .insert({ user_id: userId, secret: await encryptSecret(key, password) })

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

      await admin
        .from('credential_access_log')
        .insert({ admin_id: adminId, target_user_id: body.userId })

      return json({ password: await decryptSecret(key, data.secret) })
    }

    case 'set-password': {
      const { userId, password } = body
      if (!userId || !password) return json({ error: 'userId and password are required' }, 400)

      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) return json({ error: error.message }, 400)

      await admin
        .from('gs_credentials')
        .upsert({ user_id: userId, secret: await encryptSecret(key, password) })

      return json({ ok: true })
    }

    case 'deactivate': {
      if (!body.userId) return json({ error: 'userId is required' }, 400)

      await admin.auth.admin.updateUserById(body.userId, { ban_duration: '876000h' })
      await admin.from('project_members').delete().eq('user_id', body.userId)
      await admin.from('profiles').update({ active: false }).eq('id', body.userId)

      return json({ ok: true })
    }

    default:
      return json({ error: `Unknown action: ${body.action}` }, 400)
  }
})
