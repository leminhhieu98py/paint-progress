import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** The roles the admin hands out. An admin account is never made here. */
export type AccountRole = 'gs' | 'viewer'

export interface GsUser {
  id: string
  username: string
  fullName: string
  active: boolean
  role: AccountRole
  /** Hidden from the default list (0028); never deleted. */
  hidden: boolean
  /**
   * Every project this account can reach, in the order PostgREST returned the
   * memberships. `project_members` has always been many-to-many; a foreman who
   * covers two platforms has two rows. `allWorks` false means the account sees
   * only `workIds` of that project's `workCount` works (0028).
   */
  projects: Array<{ id: string; name: string; allWorks: boolean; workIds: string[]; workCount: number }>
}

/** One (account, project) line of the permissions dialog, as saved. */
export interface MembershipDraft {
  projectId: string
  allWorks: boolean
  /** Ignored when allWorks is true. */
  workIds: string[]
}

type Action =
  | 'create' | 'reveal' | 'set-password' | 'deactivate'
  | 'reactivate' | 'rename' | 'hide' | 'unhide'

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
  role: AccountRole
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

/** "Khoá": no sign-in, memberships kept, reversible through reactivateUser. */
export async function deactivateGsUser(userId: string): Promise<void> {
  await call<{ ok: true }>('deactivate', { userId })
}

export async function reactivateUser(userId: string): Promise<void> {
  await call<{ ok: true }>('reactivate', { userId })
}

export async function renameUser(userId: string, username: string): Promise<void> {
  await call<{ ok: true }>('rename', { userId, username })
}

/** Locks and hides. The row and every history line naming it stay. */
export async function hideUser(userId: string): Promise<void> {
  await call<{ ok: true }>('hide', { userId })
}

export async function unhideUser(userId: string): Promise<void> {
  await call<{ ok: true }>('unhide', { userId })
}

/**
 * The account's memberships, as one statement of intent: these projects, and
 * within each either every work or the listed ones. Written directly under
 * the admin RLS policies -- no privileged step is involved, so no Edge
 * Function. Not transactional across the tables; each statement is filtered
 * to this user, and a failure part-way leaves a state the dialog shows
 * faithfully on the next open.
 *
 * Grants for works of a project the account is no longer in are deleted here
 * as well, even though my_works() would already ignore them: a stale grant
 * that reappears when the project is re-added is a surprise nobody asked for.
 */
export async function setMemberships(userId: string, rows: MembershipDraft[]): Promise<void> {
  const { data: workRows, error: worksError } = await supabase.from('works').select('id, project_id')
  if (worksError) throw new Error(worksError.message)
  const works = (workRows ?? []) as { id: string; project_id: string }[]
  const worksOf = (projectId: string) => works.filter((w) => w.project_id === projectId).map((w) => w.id)

  const { data: current, error: currentError } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)
  if (currentError) throw new Error(currentError.message)
  const wanted = new Set(rows.map((r) => r.projectId))
  const removed = ((current ?? []) as { project_id: string }[])
    .map((m) => m.project_id)
    .filter((id) => !wanted.has(id))

  if (removed.length > 0) {
    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('user_id', userId)
      .in('project_id', removed)
    if (error) throw new Error(error.message)
    const orphaned = removed.flatMap(worksOf)
    if (orphaned.length > 0) {
      const { error: wmError } = await supabase
        .from('work_members')
        .delete()
        .eq('user_id', userId)
        .in('work_id', orphaned)
      if (wmError) throw new Error(wmError.message)
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('project_members')
      .upsert(
        rows.map((r) => ({ project_id: r.projectId, user_id: userId, all_works: r.allWorks })),
        { onConflict: 'project_id,user_id' },
      )
    if (error) throw new Error(error.message)
  }

  // Work grants: only the listed works of restricted projects, and only works
  // that belong to that project -- a work id from another project is dropped
  // rather than written.
  const desired = new Set(
    rows
      .filter((r) => !r.allWorks)
      .flatMap((r) => r.workIds.filter((id) => worksOf(r.projectId).includes(id))),
  )
  const { data: held, error: heldError } = await supabase
    .from('work_members')
    .select('work_id')
    .eq('user_id', userId)
  if (heldError) throw new Error(heldError.message)
  const heldIds = ((held ?? []) as { work_id: string }[]).map((w) => w.work_id)
  const stale = heldIds.filter((id) => !desired.has(id))
  const missing = [...desired].filter((id) => !heldIds.includes(id))

  if (stale.length > 0) {
    const { error } = await supabase
      .from('work_members')
      .delete()
      .eq('user_id', userId)
      .in('work_id', stale)
    if (error) throw new Error(error.message)
  }
  if (missing.length > 0) {
    const { error } = await supabase
      .from('work_members')
      .insert(missing.map((workId) => ({ work_id: workId, user_id: userId })))
    if (error) throw new Error(error.message)
  }
}

/**
 * GS and viewer accounts with their projects and work grants. Read directly
 * through RLS -- the admin policies on `profiles`, `project_members` and
 * `work_members` already permit it, so no privileged call is needed for a
 * plain listing. Hidden accounts (0028) are left out unless asked for.
 */
export async function listGsUsers(includeHidden = false): Promise<GsUser[]> {
  let query = supabase
    .from('profiles')
    .select(
      'id, username, full_name, active, role, hidden, '
      + 'project_members(project_id, all_works, projects(name)), work_members(work_id)',
    )
    .in('role', ['gs', 'viewer'])
  if (!includeHidden) query = query.eq('hidden', false)
  const { data, error } = await query.order('username')
  if (error) throw new Error(error.message)

  // The works, once, for the "n/m công việc" figure and to sort each grant
  // under its project. Small: a handful of rows per project.
  const { data: workRows, error: worksError } = await supabase.from('works').select('id, project_id')
  if (worksError) throw new Error(worksError.message)
  const works = (workRows ?? []) as { id: string; project_id: string }[]

  // Typed by hand and cast through `unknown`: no generated Database type is
  // supplied to the client, so supabase-js cannot parse a two-embed select and
  // falls back to an error type. `projects` is a single object at runtime (a
  // many-to-one embed), whatever the inferred query type would have said. Do
  // not "simplify" this back to a direct cast or an array-shaped access.
  interface ProfileRow {
    id: string
    username: string
    full_name: string
    active: boolean
    role: string
    hidden: boolean | null
    project_members: { project_id: string; all_works: boolean; projects: { name: string } | null }[] | null
    work_members: { work_id: string }[] | null
  }
  return ((data ?? []) as unknown as ProfileRow[]).map((row) => {
    const memberships = row.project_members ?? []
    const grants = new Set((row.work_members ?? []).map((g) => g.work_id))
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      active: row.active,
      role: row.role as AccountRole,
      hidden: Boolean(row.hidden),
      // A membership whose project embed came back null is dropped rather than
      // carried with a blank name: the project can be deleted between the two
      // halves of this read, and a chip reading "undefined" is worse than one
      // chip fewer.
      projects: memberships
        .filter((m) => m.projects !== null)
        .map((m) => {
          const projectWorks = works.filter((w) => w.project_id === m.project_id).map((w) => w.id)
          return {
            id: m.project_id,
            name: m.projects!.name,
            allWorks: m.all_works !== false,
            workIds: projectWorks.filter((id) => grants.has(id)),
            workCount: projectWorks.length,
          }
        }),
    }
  })
}
