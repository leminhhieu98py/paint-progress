import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface GsUser {
  id: string
  username: string
  fullName: string
  active: boolean
  projectId: string | null
  projectName: string | null
}

type Action = 'create' | 'reveal' | 'set-password' | 'deactivate'

async function call<T>(action: Action, payload: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action, ...payload },
  })
  if (error) {
    // supabase-js turns any non-2xx response into a FunctionsHttpError whose
    // `.message` is a generic "non-2xx status code" -- the function's actual
    // `{ error: string }` body is only reachable via `.context`, the raw
    // (unconsumed) Response. Without this, every error string admin-users
    // crafts for the caller never reaches the admin.
    if (error instanceof FunctionsHttpError) {
      let message = error.message
      try {
        const body: unknown = await error.context.json()
        if (body && typeof body === 'object' && 'error' in body) {
          message = String((body as { error: unknown }).error)
        }
      } catch {
        // Body wasn't JSON (or already consumed) -- fall back to the generic message.
      }
      throw new Error(message)
    }
    throw new Error(error.message)
  }
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
}

export async function createGsUser(input: {
  username: string
  fullName: string
  password: string
  projectId: string
}): Promise<string> {
  const { userId } = await call<{ userId: string }>('create', input)
  return userId
}

export async function revealPassword(userId: string): Promise<string> {
  const { password } = await call<{ password: string }>('reveal', { userId })
  return password
}

export async function setPassword(userId: string, password: string): Promise<void> {
  await call<{ ok: true }>('set-password', { userId, password })
}

export async function deactivateGsUser(userId: string): Promise<void> {
  await call<{ ok: true }>('deactivate', { userId })
}

/**
 * GS accounts with the project each belongs to. Read directly through RLS —
 * the admin policy on `profiles` and `project_members` already permits it, so
 * no privileged call is needed for a plain listing.
 */
export async function listGsUsers(): Promise<GsUser[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, full_name, active, project_members(project_id, projects(name))')
    .eq('role', 'gs')
    .order('username')

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    // supabase-js infers `projects` as an array here because no generated
    // Database type is supplied to the client, so every embed defaults to
    // one-to-many. At runtime PostgREST returns a single object for this
    // many-to-one embed (each project_members row belongs to exactly one
    // project) -- the target type below matches that runtime reality, not
    // the inferred query type, so the cast must go through `unknown` first.
    // Do not "simplify" this back to a direct cast or an array-shaped access.
    const membership = (
      row.project_members as unknown as { project_id: string; projects: { name: string } | null }[]
    )[0]
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      active: row.active,
      projectId: membership?.project_id ?? null,
      projectName: membership?.projects?.name ?? null,
    }
  })
}
