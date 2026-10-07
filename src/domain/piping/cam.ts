import { barCumSeries } from './series'
import type {
  CamSelection,
  DayKey,
  Department,
  Milestone,
  Spool,
  SpoolActualDates,
  SpoolPlanDates,
  Unit,
  ViewMode,
} from './types'
import { compareText } from './text'
import { buckets, daysBetween, formatDayMonthYear, seriesSpan, type Bucket } from './week'

/**
 * CAM Insulation -- requirement §4.3 and §6, spec §6.4 and §7, Q14-Q23.
 *
 * Everything the Insulation tab computes from the spool list: counting units,
 * group completion, the six cumulative lines, the Package / Line / Spool
 * tables, filters, duplicate SpoolNo, plan-order issues, the actual-order rule
 * used by manual entry and by the Actual import, and late warnings. Pure: the
 * caller passes today's key and the late threshold.
 */

export const MILESTONES: readonly Milestone[] = ['ph', 'ih', 'iw']

/** The milestone names as the customer's file writes them (spec §0). */
export const MILESTONE_LABEL: Record<Milestone, string> = {
  ph: 'Painting Handover',
  ih: 'Insulation Handover',
  iw: 'Insulation Work',
}

/** Who answers for a late milestone (spec §7). */
export const MILESTONE_DEPARTMENT: Record<Milestone, { department: Department; duty: string }> = {
  ph: { department: 'Piping', duty: 'bàn giao cho Painting' },
  ih: { department: 'Painting', duty: 'bàn giao cho Insulation' },
  iw: { department: 'Insulation', duty: 'thi công' },
}

/** The unit selector's labels, as the file's column names (spec §6.4). */
export const UNIT_LABEL: Record<Unit, string> = {
  spoolNo: 'SpoolNo',
  lineNo: 'LineNo',
  insuType: 'InsuType',
  drawingNo: 'DrawingNo',
  testPackageNo: 'Test Package No',
  paintingSystem: 'Painting System',
}

type Dates = Record<Milestone, DayKey | null>

/** The Spool field holding a milestone's plan date. */
export const PLAN_FIELD: Record<Milestone, keyof SpoolPlanDates> = { ph: 'phPlan', ih: 'ihPlan', iw: 'iwPlan' }
/** The Spool field holding a milestone's actual date. */
export const ACTUAL_FIELD: Record<Milestone, keyof SpoolActualDates> = { ph: 'phActual', ih: 'ihActual', iw: 'iwActual' }

/** A spool's plan dates by milestone. */
export function planDates(s: SpoolPlanDates): Dates {
  return { ph: s.phPlan, ih: s.ihPlan, iw: s.iwPlan }
}

/** A spool's actual dates by milestone. */
export function actualDates(s: SpoolActualDates): Dates {
  return { ph: s.phActual, ih: s.ihActual, iw: s.iwActual }
}

/**
 * The key SpoolNo is compared by -- duplicates, the plan diff (R-10) and the
 * Actual import (R-11) all match on it. Spaces trimmed from both ends and
 * nothing else, exactly as Postgres `btrim(spool_no)` does in
 * `piping_replace_spools`, so the preview pairs spools the way the database
 * will. Case and inner spaces are kept: SpoolNo values are codes, and folding
 * them could merge two spools the customer keeps apart.
 */
export function spoolKey(spoolNo: string): string {
  return spoolNo.replace(/^ +| +$/g, '')
}

/** A text value as a group key; blank and null are no value. */
function groupValue(value: string | null): string | null {
  const v = value?.trim() ?? ''
  return v === '' ? null : v
}


// ---------------------------------------------------------------------------
// Order rule
// ---------------------------------------------------------------------------

const ORDER_PAIRS: ReadonlyArray<[Milestone, Milestone]> = [['ph', 'ih'], ['ph', 'iw'], ['ih', 'iw']]

/**
 * The pairs that break PH <= IH <= IW, over the dates present only (Q15B for
 * plans, Q18A for actuals). With IH missing, PH is still compared with IW.
 */
export function orderViolations(dates: Dates): Array<[Milestone, Milestone]> {
  return ORDER_PAIRS.filter(([a, b]) => {
    const da = dates[a]
    const db = dates[b]
    return da !== null && db !== null && da > db
  }).map(([a, b]) => [a, b])
}

/** `Sai thứ tự: Painting Handover (06/09/2026) sau Insulation Handover (05/09/2026)`. */
export function orderMessage(dates: Dates, pairs: Array<[Milestone, Milestone]>): string {
  return `Sai thứ tự: ${pairs
    .map(([a, b]) => `${MILESTONE_LABEL[a]} (${formatDayMonthYear(dates[a]!)}) sau ${MILESTONE_LABEL[b]} (${formatDayMonthYear(dates[b]!)})`)
    .join('; ')}`
}

// ---------------------------------------------------------------------------
// Units and group completion
// ---------------------------------------------------------------------------

/**
 * A group's milestone dates (Q17A, R-13): it reaches a milestone on the date
 * its LAST spool does, and only when ALL its spools have that date; its plan
 * date is the latest plan date of its spools, and none if any spool lacks one.
 */
export function rollupDates(spools: Spool[]): { plan: Dates; actual: Dates } {
  const roll = (field: (m: Milestone) => keyof Spool): Dates => {
    const out: Dates = { ph: null, ih: null, iw: null }
    for (const m of MILESTONES) {
      let latest: DayKey | null = null
      let complete = spools.length > 0
      for (const s of spools) {
        const d = s[field(m)] as DayKey | null
        if (d === null) {
          complete = false
          break
        }
        if (latest === null || d > latest) latest = d
      }
      out[m] = complete ? latest : null
    }
    return out
  }
  return { plan: roll((m) => PLAN_FIELD[m]), actual: roll((m) => ACTUAL_FIELD[m]) }
}

/** One counted thing on the chart: a spool row, or a group of spools. */
export interface CamItem {
  /** The spool id for SpoolNo; the group value otherwise. */
  key: string
  label: string
  spools: Spool[]
  plan: Dates
  actual: Dates
}

/**
 * The things a unit counts (spec §6.4). SpoolNo counts spool ROWS, duplicate
 * numbers included; every other unit counts distinct values. A spool whose
 * value is blank belongs to no group of that unit: a blank LineNo is not a
 * Line, so it is not counted as one.
 */
export function camItems(spools: Spool[], unit: Unit): CamItem[] {
  const ordered = [...spools].sort((a, b) => a.seq - b.seq)
  if (unit === 'spoolNo') {
    return ordered.map((s) => ({ key: s.id, label: s.spoolNo, spools: [s], plan: planDates(s), actual: actualDates(s) }))
  }
  const groups = new Map<string, Spool[]>()
  for (const s of ordered) {
    const v = groupValue(s[unit])
    if (v === null) continue
    const list = groups.get(v)
    if (list) list.push(s)
    else groups.set(v, [s])
  }
  return [...groups.entries()].map(([key, list]) => ({ key, label: key, spools: list, ...rollupDates(list) }))
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

export type CamSeriesKey = 'phPlan' | 'phActual' | 'ihPlan' | 'ihActual' | 'iwPlan' | 'iwActual'

/** One bucket of the Insulation chart: six cumulative counts. */
export type CamPoint = Bucket & Record<CamSeriesKey, number | null>

/**
 * The Insulation chart (spec §6.4): per milestone, the cumulative number of
 * items that reached it by each bucket's last day, Plan and Actual. All three
 * plan lines run to the plan's overall last day (the latest plan date of any
 * item and milestone), so they end together; actual lines run to today.
 * `total` is the number of items, the lines' ceiling. Empty without any date.
 */
export function camSeries(input: {
  spools: Spool[]
  unit: Unit
  mode: ViewMode
  weekStart: DayKey
  todayKey: DayKey
}): { points: CamPoint[]; total: number } {
  const items = camItems(input.spools, input.unit)
  const counts = (pick: (i: CamItem) => Dates, m: Milestone) => {
    const out = new Map<DayKey, number>()
    for (const i of items) {
      const d = pick(i)[m]
      if (d !== null) out.set(d, (out.get(d) ?? 0) + 1)
    }
    return out
  }
  const plan = Object.fromEntries(MILESTONES.map((m) => [m, counts((i) => i.plan, m)])) as Record<Milestone, Map<DayKey, number>>
  const actual = Object.fromEntries(MILESTONES.map((m) => [m, counts((i) => i.actual, m)])) as Record<Milestone, Map<DayKey, number>>
  const planDays = MILESTONES.flatMap((m) => [...plan[m].keys()])
  const allDays = [...planDays, ...MILESTONES.flatMap((m) => [...actual[m].keys()])]
  const span = seriesSpan(allDays, input.todayKey)
  if (span === null) return { points: [], total: items.length }
  const planEnd = planDays.length > 0 ? planDays.reduce((a, b) => (b > a ? b : a)) : null
  const axis = buckets(span.from, span.to, input.mode, input.weekStart)
  const perMilestone = MILESTONES.map((m) => barCumSeries({
    buckets: axis, plan: plan[m], actual: actual[m], planEnd, todayKey: input.todayKey,
  }))
  const points = axis.map((bucket, i) => ({
    ...bucket,
    phPlan: perMilestone[0][i].planCum,
    phActual: perMilestone[0][i].actualCum,
    ihPlan: perMilestone[1][i].planCum,
    ihActual: perMilestone[1][i].actualCum,
    iwPlan: perMilestone[2][i].planCum,
    iwActual: perMilestone[2][i].actualCum,
  }))
  return { points, total: items.length }
}

/** The lines the Plan | Actual | Plan & Actual toggle shows (Q20A). */
export function camSeriesKeys(selection: CamSelection): CamSeriesKey[] {
  const out: CamSeriesKey[] = []
  for (const m of MILESTONES) {
    if (selection !== 'actual') out.push(`${m}Plan`)
    if (selection !== 'plan') out.push(`${m}Actual`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Detail table
// ---------------------------------------------------------------------------

export interface MilestoneCount {
  /** Spools with the actual date. */
  done: number
  /** Spools with the plan date. */
  planned: number
  total: number
}

/** A Package or Line row of the detail table. */
export interface CamGroupRow {
  /** The Test Package No or LineNo; '' for the spools that have none. */
  key: string
  spools: Spool[]
  counts: Record<Milestone, MilestoneCount>
  plan: Dates
  actual: Dates
}

/**
 * The Package or Line level rows (Q16B): Line is grouped on its own, not
 * nested under Package. Spools with a blank value form one row keyed '' so no
 * spool drops out of the table (the UI shows `-`). Sorted by key.
 */
export function camGroupRows(spools: Spool[], level: 'package' | 'line'): CamGroupRow[] {
  const field = level === 'package' ? 'testPackageNo' : 'lineNo'
  const groups = new Map<string, Spool[]>()
  for (const s of [...spools].sort((a, b) => a.seq - b.seq)) {
    const key = groupValue(s[field]) ?? ''
    const list = groups.get(key)
    if (list) list.push(s)
    else groups.set(key, [s])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([key, list]) => {
      const counts = {} as Record<Milestone, MilestoneCount>
      for (const m of MILESTONES) {
        counts[m] = {
          done: list.filter((s) => s[ACTUAL_FIELD[m]] !== null).length,
          planned: list.filter((s) => s[PLAN_FIELD[m]] !== null).length,
          total: list.length,
        }
      }
      return { key, spools: list, counts, ...rollupDates(list) }
    })
}

/** The flags a Spool row shows. */
export interface CamSpoolFlags {
  duplicate: boolean
  planOrder: boolean
  /** The milestones that are late (spec §7), in PH, IH, IW order. */
  late: Milestone[]
}

/** Flags for every spool, by id. */
export function camSpoolFlags(spools: Spool[], thresholdDays: number, todayKey: DayKey): Map<string, CamSpoolFlags> {
  const duplicates = new Set(duplicateSpoolGroups(spools).flatMap((g) => g.rows.map((s) => s.id)))
  const late = new Map<string, Milestone[]>()
  for (const w of lateWarnings(spools, thresholdDays, todayKey)) {
    const list = late.get(w.spoolId)
    if (list) list.push(w.milestone)
    else late.set(w.spoolId, [w.milestone])
  }
  return new Map(spools.map((s) => [s.id, {
    duplicate: duplicates.has(s.id),
    planOrder: orderViolations(planDates(s)).length > 0,
    late: late.get(s.id) ?? [],
  }]))
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** The Insulation filters (spec §6.4). An empty list filters nothing. */
export interface CamFilters {
  insuTypes: string[]
  paintingSystems: string[]
  testPackageNos: string[]
  /** Case-insensitive substring of SpoolNo or LineNo. */
  search: string
}

/** The spools passing every filter: AND across filters, OR within a list. */
export function filterSpools(spools: Spool[], filters: CamFilters): Spool[] {
  const inList = (list: string[], value: string | null) => list.length === 0 || list.includes(groupValue(value) ?? '')
  const q = filters.search.trim().toLowerCase()
  return spools.filter((s) => inList(filters.insuTypes, s.insuType)
    && inList(filters.paintingSystems, s.paintingSystem)
    && inList(filters.testPackageNos, s.testPackageNo)
    && (q === '' || s.spoolNo.toLowerCase().includes(q) || (s.lineNo ?? '').toLowerCase().includes(q)))
}

/** The distinct non-blank values each filter offers, sorted. */
export function filterOptions(spools: Spool[]): { insuTypes: string[]; paintingSystems: string[]; testPackageNos: string[] } {
  const distinct = (pick: (s: Spool) => string | null) => {
    const set = new Set<string>()
    for (const s of spools) {
      const v = groupValue(pick(s))
      if (v !== null) set.add(v)
    }
    return [...set].sort(compareText)
  }
  return {
    insuTypes: distinct((s) => s.insuType),
    paintingSystems: distinct((s) => s.paintingSystem),
    testPackageNos: distinct((s) => s.testPackageNo),
  }
}

// ---------------------------------------------------------------------------
// Duplicates and plan order
// ---------------------------------------------------------------------------

/**
 * Every SpoolNo occurring more than once (Q14C), with its rows in the order
 * given (file order), groups in order of first appearance.
 */
export function duplicateSpoolGroups<T extends { spoolNo: string }>(rows: T[]): Array<{ spoolNo: string; rows: T[] }> {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const key = spoolKey(r.spoolNo)
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  return [...groups.entries()].filter(([, list]) => list.length > 1).map(([spoolNo, list]) => ({ spoolNo, rows: list }))
}

/** The rows whose plan dates break PH <= IH <= IW (Q15B): imported, but listed. */
export function planOrderIssues<T extends SpoolPlanDates>(rows: T[]): Array<{ row: T; pairs: Array<[Milestone, Milestone]> }> {
  const out: Array<{ row: T; pairs: Array<[Milestone, Milestone]> }> = []
  for (const row of rows) {
    const pairs = orderViolations(planDates(row))
    if (pairs.length > 0) out.push({ row, pairs })
  }
  return out
}

// ---------------------------------------------------------------------------
// Actual changes (manual entry and Actual import)
// ---------------------------------------------------------------------------

/** Set (or, with null, clear) one milestone's actual date on one spool. */
export interface ActualChange {
  spoolId: string
  milestone: Milestone
  date: DayKey | null
}

export interface ActualOverwrite {
  spoolId: string
  spoolNo: string
  milestone: Milestone
  from: DayKey
  to: DayKey | null
}

export interface ActualRejection {
  spoolId: string
  spoolNo: string
  reason: 'future' | 'order' | 'notFound'
  message: string
}

export interface ActualResolution {
  /** What to save, per spool, in order of first appearance. */
  updates: Array<{ spoolId: string; spoolNo: string; changes: Array<{ milestone: Milestone; date: DayKey | null }> }>
  /** Saved changes that replace an existing date: confirm before saving. */
  overwrites: ActualOverwrite[]
  /** Changes equal to what is stored already. */
  unchanged: Array<{ spoolId: string; spoolNo: string; milestone: Milestone }>
  /** Spools not saved at all, with the reason (spec §6.3). */
  rejected: ActualRejection[]
}

/**
 * Applies actual changes to spools and sorts them into saved, overwritten,
 * unchanged and rejected (spec §6.3, Q18A).
 *
 * A spool is judged as a whole: if any of its changes is dated after today, or
 * its resulting actual dates break PH <= IH <= IW (existing dates included),
 * NONE of its changes is saved and it is listed as rejected. In a bulk apply
 * that is exactly "violators are listed and skipped, the rest saved"; the
 * import refuses the whole file on any rejection. A null date clears (an
 * admin-only action, which the caller and the RPC gate). Two changes to the
 * same spool and milestone: the last wins -- the import catches conflicting
 * rows itself, with their row numbers, before calling this.
 */
export function resolveActualChanges(spools: Spool[], changes: ActualChange[], todayKey: DayKey): ActualResolution {
  const byId = new Map(spools.map((s) => [s.id, s]))
  const grouped = new Map<string, Map<Milestone, DayKey | null>>()
  for (const c of changes) {
    let m = grouped.get(c.spoolId)
    if (!m) {
      m = new Map()
      grouped.set(c.spoolId, m)
    }
    m.set(c.milestone, c.date)
  }
  const res: ActualResolution = { updates: [], overwrites: [], unchanged: [], rejected: [] }
  for (const [spoolId, wanted] of grouped) {
    const spool = byId.get(spoolId)
    if (!spool) {
      res.rejected.push({ spoolId, spoolNo: '', reason: 'notFound', message: 'Không tìm thấy spool' })
      continue
    }
    const current = actualDates(spool)
    const ordered = MILESTONES.filter((m) => wanted.has(m))
    const future = ordered.find((m) => {
      const d = wanted.get(m)!
      return d !== null && d > todayKey
    })
    if (future) {
      res.rejected.push({
        spoolId, spoolNo: spool.spoolNo, reason: 'future',
        message: `${MILESTONE_LABEL[future]}: ngày ${formatDayMonthYear(wanted.get(future)!)} sau hôm nay`,
      })
      continue
    }
    const next: Dates = { ...current }
    for (const m of ordered) next[m] = wanted.get(m)!
    const pairs = orderViolations(next)
    if (pairs.length > 0) {
      res.rejected.push({ spoolId, spoolNo: spool.spoolNo, reason: 'order', message: orderMessage(next, pairs) })
      continue
    }
    const saved: Array<{ milestone: Milestone; date: DayKey | null }> = []
    for (const m of ordered) {
      const to = next[m]
      const from = current[m]
      if (to === from) {
        res.unchanged.push({ spoolId, spoolNo: spool.spoolNo, milestone: m })
        continue
      }
      saved.push({ milestone: m, date: to })
      if (from !== null) res.overwrites.push({ spoolId, spoolNo: spool.spoolNo, milestone: m, from, to })
    }
    if (saved.length > 0) res.updates.push({ spoolId, spoolNo: spool.spoolNo, changes: saved })
  }
  return res
}

// ---------------------------------------------------------------------------
// Late warnings
// ---------------------------------------------------------------------------

export interface LateWarning {
  spoolId: string
  spoolNo: string
  lineNo: string | null
  testPackageNo: string | null
  milestone: Milestone
  department: Department
  plan: DayKey
  actual: DayKey | null
  /** Days past the PLAN date (actual, or today when there is none). */
  daysLate: number
}

/**
 * Late milestones (spec §7), N = `thresholdDays`: late when the actual is after
 * plan + N, or there is no actual and today is after plan + N. No plan, never
 * late. N is a tolerance, not the measure: `daysLate` counts from the plan date
 * itself, which is the delay a reader compares against the plan column beside
 * it. In spool order, then PH, IH, IW.
 */
export function lateWarnings(spools: Spool[], thresholdDays: number, todayKey: DayKey): LateWarning[] {
  const out: LateWarning[] = []
  for (const s of [...spools].sort((a, b) => a.seq - b.seq)) {
    for (const m of MILESTONES) {
      const plan = s[PLAN_FIELD[m]]
      if (plan === null) continue
      const actual = s[ACTUAL_FIELD[m]]
      const daysLate = daysBetween(plan, actual ?? todayKey)
      if (daysLate <= thresholdDays) continue
      out.push({
        spoolId: s.id,
        spoolNo: s.spoolNo,
        lineNo: s.lineNo,
        testPackageNo: s.testPackageNo,
        milestone: m,
        department: MILESTONE_DEPARTMENT[m].department,
        plan,
        actual,
        daysLate,
      })
    }
  }
  return out
}

/** "N spool trễ": distinct spools with at least one late milestone. */
export function lateSpoolCount(warnings: LateWarning[]): number {
  return new Set(warnings.map((w) => w.spoolId)).size
}

/** The "Spool trễ" table grouped by Package or Line; '' for none, sorted by key. */
export function groupLateWarnings(
  warnings: LateWarning[],
  by: 'package' | 'line',
): Array<{ key: string; warnings: LateWarning[] }> {
  const groups = new Map<string, LateWarning[]>()
  for (const w of warnings) {
    const key = groupValue(by === 'package' ? w.testPackageNo : w.lineNo) ?? ''
    const list = groups.get(key)
    if (list) list.push(w)
    else groups.set(key, [w])
  }
  return [...groups.entries()].sort(([a], [b]) => compareText(a, b)).map(([key, list]) => ({ key, warnings: list }))
}
