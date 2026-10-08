import type { KeyFact } from '../../../components/KeyFacts'
import { groupLateWarnings, lateSpoolCount, type LateWarning } from '../../../domain/piping/cam'
import type { Milestone } from '../../../domain/piping/types'
import { formatQty } from '../pipingFormat'

/** What makes a spool late (spec §7), with the project's threshold N. */
export function lateRule(thresholdDays: number): string {
  return `Spool có ít nhất một mốc trễ quá ${formatQty(thresholdDays)} ngày so với ngày Plan`
    + ' (chưa có Actual thì tính đến hôm nay)'
}

/** The "N spool trễ" pill (HLT-01), for everyone; none while no spool is late. */
export function lateFact(warnings: LateWarning[], thresholdDays: number): KeyFact | null {
  const count = lateSpoolCount(warnings)
  if (count === 0) return null
  return { value: formatQty(count), label: 'spool trễ', tone: 'warning', info: lateRule(thresholdDays) }
}

/** One Package (or Line) row of the "Spool trễ" card. */
export interface LateGroupRow {
  /** The package or line; '' for the spools with none. */
  key: string
  /** Distinct late spools in the group. */
  spoolCount: number
  /** Late milestones per milestone. */
  counts: Record<Milestone, number>
  /** The group's late milestones, in spool order then PH, IH, IW. */
  warnings: LateWarning[]
}

/**
 * The "Spool trễ" card's rows, grouped by Package or Line (spec §7), sorted
 * by name; the spools with no package (or line) share one row, last, as in
 * the detail table.
 */
export function lateGroupRows(warnings: LateWarning[], by: 'package' | 'line'): LateGroupRow[] {
  const rows = groupLateWarnings(warnings, by).map(({ key, warnings: list }) => {
    const counts: Record<Milestone, number> = { ph: 0, ih: 0, iw: 0 }
    for (const w of list) counts[w.milestone] += 1
    return { key, spoolCount: lateSpoolCount(list), counts, warnings: list }
  })
  return [...rows.filter((r) => r.key !== ''), ...rows.filter((r) => r.key === '')]
}
