import { loadGsProjectIdentity } from '../../lib/gsApi'
import { listProjectNames } from '../../lib/projectsApi'
import { onSessionEnd } from '../../lib/sessionCache'

/**
 * Project names for the field header, read once per session (M-1).
 *
 * The header remounts on every field page and every project switch, so a read
 * of its own would run each time. Instead: GsScreen hands over the name from
 * the project row it already loads (`rememberProjectName`), the viewer's list
 * is read once and shared, and only a page opened cold (Năng suất or KPI by
 * deep link) reads one name. Forgotten when the session ends.
 */
type ProjectName = { id: string; name: string; code: string }

const names = new Map<string, string>()
let list: ProjectName[] | undefined
let listRead: Promise<ProjectName[]> | null = null
/** Bumped at the end of a session, so a read still in flight then is dropped. */
let generation = 0

onSessionEnd(() => {
  names.clear()
  list = undefined
  listRead = null
  generation += 1
})

/** A name a screen already has, so the header need not read it. */
export function rememberProjectName(projectId: string, name: string): void {
  names.set(projectId, name)
}

export function cachedProjectName(projectId: string): string | undefined {
  return names.get(projectId)
}

export function cachedProjectList(): ProjectName[] | undefined {
  return list
}

/** The project's name: from the session when known, else one read, then kept. */
export async function fieldProjectName(projectId: string): Promise<string> {
  const known = names.get(projectId)
  if (known !== undefined) return known
  const mine = generation
  const { name } = await loadGsProjectIdentity(projectId)
  if (mine === generation) names.set(projectId, name)
  return name
}

/** Every project the viewer reads (RV6-24): one read per session, shared by concurrent callers. */
export function fieldProjectList(): Promise<ProjectName[]> {
  if (list !== undefined) return Promise.resolve(list)
  if (listRead !== null) return listRead
  const mine = generation
  const read = listProjectNames().then(
    (rows) => {
      if (mine === generation) {
        list = rows
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
