import { onSessionEnd } from '../../lib/sessionCache'

/**
 * Filters handed from one field page to the same page of another project
 * (I-1). The field Năng suất and KPI pages remount on a project switch (they
 * are keyed by the project), so what is applied is left here for the next
 * mount to open on. In memory, not in the router's state: the filters hold
 * dates, which history's structured clone would strip to plain objects.
 * Read during the first render (`peekCarried`) and cleared once mounted
 * (`clearCarried`), so a later visit to the page opens on its defaults.
 */
const carried = new Map<string, unknown>()

// A carry whose page never mounted must not open the next account's page (RR-M5).
onSessionEnd(() => carried.clear())

const keyOf = (page: string, projectId: string) => `${page}:${projectId}`

export function carryFilters(page: string, projectId: string, filters: unknown): void {
  carried.set(keyOf(page, projectId), filters)
}

export function peekCarried<T>(page: string, projectId: string | null): T | undefined {
  return projectId === null ? undefined : (carried.get(keyOf(page, projectId)) as T | undefined)
}

export function clearCarried(page: string, projectId: string | null): void {
  if (projectId !== null) carried.delete(keyOf(page, projectId))
}
