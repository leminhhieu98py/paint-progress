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

/** A work as the bar shows it: the events of a work with no name still count, under this. */
export function workLabel(name: string): string {
  return name === '' ? '(không rõ công việc)' : name
}

/**
 * How many filters are off their defaults, for the phone's Bộ lọc badge
 * (FLT-04): a work other than the first, a deck, a date range (once,
 * whichever end is set).
 */
export function productivityFilterCount(filters: ProductivityFilters, workNames: string[]): number {
  const work = filters.work !== null && resolveWork(filters.work, workNames) !== resolveWork(null, workNames)
  const dates = filters.range[0] !== null || filters.range[1] !== null
  return [work, filters.deck !== '', dates].filter(Boolean).length
}

const DAY = 'DD/MM/YYYY'

/**
 * What is applied, in one line, for the phone's bar (FLT-04): the project's code (M2) · deck
 * · work, then the dates when set. A project or work not known yet is left
 * out rather than guessed.
 */
export function productivitySummary(project: string | undefined, filters: ProductivityFilters, workNames: string[]): string {
  const [from, to] = filters.range
  const dates = from && to
    ? `${from.format(DAY)} – ${to.format(DAY)}`
    : from ? `Từ ${from.format(DAY)}` : to ? `Đến ${to.format(DAY)}` : undefined
  return [
    project,
    filters.deck || 'Tất cả sàn',
    workNames.length > 0 ? workLabel(resolveWork(filters.work, workNames)) : undefined,
    dates,
  ].filter((part) => part !== undefined).join(' · ')
}
