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
  if (error) throw new Error(error.message)
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
    const membership = (row.project_members as { project_id: string; projects: { name: string } | null }[])[0]
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
