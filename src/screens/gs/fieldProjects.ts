import { listProjectNames } from '../../lib/projectsApi'
import { onSessionEnd } from '../../lib/sessionCache'

/**
 * Project names for the field's Dự án switch, read once per session (M-1).
 *
 * The switch remounts on every field page and every project switch, so a read
 * of its own would run each time. Instead the list -- a foreman's memberships,
 * a viewer's every project, as RLS answers it -- is read once and shared, and
 * GsScreen hands over the name from the project row it already loads
 * (`rememberProjectName`) for the moment before the list lands. Forgotten when
 * the session ends.
 */
type ProjectName = { id: string; name: string; code: string }

const names = new Map<string, string>()
let list: ProjectName[] | undefined
let listRead: Promise<ProjectName[]> | null = null
/** Projects the list was re-read for because it lacked them: once each per session (M-1b). */
const refreshedFor = new Set<string>()
/** Bumped at the end of a session, so a read still in flight then is dropped. */
let generation = 0

onSessionEnd(() => {
  names.clear()
  list = undefined
  listRead = null
  refreshedFor.clear()
  generation += 1
})

/** A name a screen already has, for the switch to show before its list lands. */
export function rememberProjectName(projectId: string, name: string): void {
  names.set(projectId, name)
}

export function cachedProjectName(projectId: string): string | undefined {
  return names.get(projectId)
}

/** A project's code from the session's list, for the phone's filter summary (M2); undefined until read. */
export function cachedProjectCode(projectId: string): string | undefined {
  return list?.find((p) => p.id === projectId)?.code
}

export function cachedProjectList(): ProjectName[] | undefined {
  return list
}

/**
 * A fresh read of every project someone else already made (the viewer's
 * picker, M-1b), taken as the session's list.
 */
export function seedProjectList(rows: ProjectName[]): void {
  list = rows.map(({ id, name, code }) => ({ id, name, code }))
  for (const row of list) names.set(row.id, row.name)
}

/** Every project the viewer reads (RV6-24): one read per session, shared by concurrent callers. */
export function fieldProjectList(): Promise<ProjectName[]> {
  if (list !== undefined) return Promise.resolve(list)
  return readList()
}

/**
 * The list, for a switch showing `projectId`. A cached list without it is
 * stale (a project created since it was read, M-1b), so it is re-read -- once
 * per project per session, so an id that is gone for good does not cost a
 * read on every page.
 */
export function projectListFor(projectId: string): Promise<ProjectName[]> {
  if (list === undefined) return readList()
  if (list.some((p) => p.id === projectId) || refreshedFor.has(projectId)) return Promise.resolve(list)
  refreshedFor.add(projectId)
  return readList()
}

function readList(): Promise<ProjectName[]> {
  if (listRead !== null) return listRead
  const mine = generation
  const read = listProjectNames().then(
    (rows) => {
      if (mine === generation) {
        list = rows
        listRead = null
        for (const row of rows) names.set(row.id, row.name)
      }
      return rows
    },
    (e: unknown) => {
      // A failed read is not kept: the next mount tries again.
      if (mine === generation) listRead = null
      throw e
    },
  )
  listRead = read
  return read
}
