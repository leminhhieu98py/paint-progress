import type { Dayjs } from 'dayjs'
import type { DeckEvent, WorkModel } from '../../domain/types'

/**
 * What the Năng suất filter bar narrows the dashboard to (FLT-01). The screen
 * holds it, so the project select and these controls sit in one bar under the
 * title; the dashboard only reads it.
 */
export interface ProductivityFilters {
  /** The chosen work's name; null is the first work, as the page opens. */
  work: string | null
  /** A deck name; '' is Tất cả sàn. */
  deck: string
  range: [Dayjs | null, Dayjs | null]
}

export const DEFAULT_PRODUCTIVITY_FILTERS: ProductivityFilters = { work: null, deck: '', range: [null, null] }

/**
 * The works the dashboard can show, in seq order: every bays work of the
 * model, then any work the events remember but the model no longer has
 * (renamed, deleted) -- it still holds hours somebody typed.
 */
export function dashboardWorkNames(models: WorkModel[], events: DeckEvent[]): string[] {
  const names = [...models]
    .filter((m) => m.work.kind === 'bays')
    .sort((a, b) => a.work.seq - b.work.seq)
    .map((m) => m.work.name)
  for (const ev of events) {
    const name = ev.workName ?? ''
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/** The work actually shown: the chosen one while it exists, else the first. */
export function resolveWork(work: string | null, workNames: string[]): string {
  return work !== null && workNames.includes(work) ? work : workNames[0] ?? ''
}
