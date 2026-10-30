import type { KeyFact } from '../../../components/KeyFacts'
import { groupLateWarnings, lateSpoolCount, MILESTONE_LABEL, MILESTONES, type LateWarning } from '../../../domain/piping/cam'
import type { Milestone } from '../../../domain/piping/types'
import { matchesSearch } from '../../../lib/search'
import { formatQty } from '../pipingFormat'

/** What makes a spool late (spec §7), with the project's threshold N. */
export function lateRule(thresholdDays: number): string {
  return `Spool có ít nhất một mốc trễ quá ${formatQty(thresholdDays)} ngày so với ngày Plan`
    + ' (chưa có Actual thì tính đến hôm nay)'
}

/** What makes a spool late on one milestone (RV9-3), with the project's threshold N. */
export function lateMilestoneRule(m: Milestone, thresholdDays: number): string {
  return `Spool có mốc ${MILESTONE_LABEL[m]} trễ quá ${formatQty(thresholdDays)} ngày so với ngày Plan`
    + ' (chưa có Actual thì tính đến hôm nay)'
}

/**
 * The late pills (RV9-3), for everyone, one per milestone: `Pip 301 spool trễ`
 * (amber while any, neutral at 0), or `Insu Chưa có Plan` while no spool has
 * that milestone's plan date.
 */
export function lateFacts(counts: Record<Milestone, { planned: boolean; late: number }>, thresholdDays: number): KeyFact[] {
  return MILESTONES.map((m): KeyFact => (counts[m].planned
    ? {
        prefix: MILESTONE_LABEL[m],
        value: formatQty(counts[m].late),
        label: 'spool trễ',
        tone: counts[m].late > 0 ? 'warning' : 'neutral',
        info: lateMilestoneRule(m, thresholdDays),
      }
    : { prefix: MILESTONE_LABEL[m], label: 'Chưa có Plan', tone: 'neutral' }))
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
 * True when the late milestone's spool matches the card's search: its
 * SpoolNo, LineNo or Test Package No contains it, case- and accent-blind
 * (RV8-10). A blank search matches every spool.
 */
export function lateWarningMatches(w: LateWarning, search: string): boolean {
  return [w.spoolNo, w.lineNo ?? '', w.testPackageNo ?? ''].some((v) => matchesSearch(v, search))
}

function groupRow(key: string, list: LateWarning[]): LateGroupRow {
  const counts: Record<Milestone, number> = { ph: 0, ih: 0, iw: 0 }
  for (const w of list) counts[w.milestone] += 1
  return { key, spoolCount: lateSpoolCount(list), counts, warnings: list }
}

/**
 * The "Spool trễ" card's rows, grouped by Package or Line (spec §7), sorted
 * by name; the spools with no package (or line) share one row, last, as in
 * the detail table. A search keeps a group whose name matches with all its
 * spools, and any other group with only its matching spools (RV8-10).
 */
export function lateGroupRows(warnings: LateWarning[], by: 'package' | 'line', search = ''): LateGroupRow[] {
  const rows = groupLateWarnings(warnings, by)
    .map(({ key, warnings: list }) => groupRow(
      key,
      key !== '' && matchesSearch(key, search) ? list : list.filter((w) => lateWarningMatches(w, search)),
    ))
    .filter((r) => r.warnings.length > 0)
  return [...rows.filter((r) => r.key !== ''), ...rows.filter((r) => r.key === '')]
}

/** One row of the card's Spool level: a late spool and its late milestones. */
export interface LateSpoolRow {
  spoolId: string
  spoolNo: string
  lineNo: string | null
  testPackageNo: string | null
  /** The spool's late milestones; a milestone on time is absent. */
  late: Partial<Record<Milestone, LateWarning>>
}

/** The card's Spool level (RV8-10): one row per late spool matching the search, in spool order. */
export function lateSpoolRows(warnings: LateWarning[], search = ''): LateSpoolRow[] {
  const rows = new Map<string, LateSpoolRow>()
  for (const w of warnings) {
    if (!lateWarningMatches(w, search)) continue
    const row = rows.get(w.spoolId)
    if (row) row.late[w.milestone] = w
    else {
      rows.set(w.spoolId, {
        spoolId: w.spoolId, spoolNo: w.spoolNo, lineNo: w.lineNo, testPackageNo: w.testPackageNo, late: { [w.milestone]: w },
      })
    }
  }
  return [...rows.values()]
}
