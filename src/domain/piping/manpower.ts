import type { DayKey, ManpowerGroup, ManpowerValue, ViewMode } from './types'
import { buckets, seriesSpan, type Bucket } from './week'

/**
 * Manpower -- requirement §4.2, spec §5, Q5, Q11-Q13.
 *
 * One value per (group, day), plan and actual. Total = sum of the groups,
 * computed here and never stored. The chart stacks the groups for Plan and for
 * Actual side by side per day/week, with a total line each.
 *
 * Week view is an AVERAGE, not a sum (R-2): per group, the mean of the days in
 * the week that HAVE a value -- an entered 0 counts, a day with no entry does
 * not. That reads Linh's "trung bình 7 ngày" the same whether the plan was
 * imported daily or one row per week (the sample workbook's own shape).
 *
 * The week total is the sum of the group averages, not the average of the daily
 * totals: the two differ when groups were entered on different days, and only
 * the first lands on the top of the stacked bar it is drawn over.
 */

/** One bucket: each group's value (by group id) and the totals. */
export interface ManpowerPoint extends Bucket {
  plan: Record<string, number | null>
  actual: Record<string, number | null>
  /** Sum of the groups that have a value; null when none has. */
  planTotal: number | null
  actualTotal: number | null
}

function bySort(a: ManpowerGroup, b: ManpowerGroup): number {
  return a.sort - b.sort || a.name.localeCompare(b.name)
}

/** Per group, per day: the value. Later duplicates overwrite (the key is unique in the DB). */
function index(values: ManpowerValue[], known: Set<string>, lastDay: DayKey | null): Map<string, Map<DayKey, number>> {
  const out = new Map<string, Map<DayKey, number>>()
  for (const { groupId, day, value } of values) {
    if (!known.has(groupId)) continue
    if (lastDay !== null && day > lastDay) continue
    let days = out.get(groupId)
    if (!days) {
      days = new Map()
      out.set(groupId, days)
    }
    days.set(day, value)
  }
  return out
}

/** The mean of the values on days in [start, end]; null when no day has one. */
function averageWithin(days: Map<DayKey, number> | undefined, start: DayKey, end: DayKey): number | null {
  if (!days) return null
  let sum = 0
  let n = 0
  for (const [day, value] of days) {
    if (day >= start && day <= end) {
      sum += value
      n += 1
    }
  }
  return n === 0 ? null : sum / n
}

function rowFor(
  groups: ManpowerGroup[],
  values: Map<string, Map<DayKey, number>>,
  start: DayKey,
  end: DayKey,
): { byGroup: Record<string, number | null>; total: number | null } {
  const byGroup: Record<string, number | null> = {}
  let total: number | null = null
  for (const g of groups) {
    const value = averageWithin(values.get(g.id), start, end)
    byGroup[g.id] = value
    if (value !== null) total = (total ?? 0) + value
  }
  return { byGroup, total }
}

/**
 * The chart rows. Day view shows each day's own value (a weekly plan row shows
 * on its date only, spec §3); week view averages (R-2). Actual is null for a
 * bucket after today and never reads a value dated after today. Every group in
 * `groups` gets a key, hidden ones included (R-8). Empty without any value.
 */
export function manpowerSeries(input: {
  groups: ManpowerGroup[]
  plan: ManpowerValue[]
  actual: ManpowerValue[]
  mode: ViewMode
  weekStart: DayKey
  todayKey: DayKey
}): ManpowerPoint[] {
  const groups = [...input.groups].sort(bySort)
  const known = new Set(groups.map((g) => g.id))
  const plan = index(input.plan, known, null)
  const actual = index(input.actual, known, input.todayKey)
  const days: DayKey[] = []
  for (const m of [plan, actual]) for (const byDay of m.values()) days.push(...byDay.keys())
  const span = seriesSpan(days, input.todayKey)
  if (span === null) return []
  return buckets(span.from, span.to, input.mode, input.weekStart).map((bucket) => {
    const p = rowFor(groups, plan, bucket.start, bucket.end)
    const a = bucket.start <= input.todayKey
      ? rowFor(groups, actual, bucket.start, bucket.end)
      : { byGroup: Object.fromEntries(groups.map((g) => [g.id, null])), total: null }
    return { ...bucket, plan: p.byGroup, actual: a.byGroup, planTotal: p.total, actualTotal: a.total }
  })
}

/**
 * The groups the chart draws, in sort order: every visible group, and a hidden
 * group only while it has any plan or actual value (R-8), so hiding a group
 * never erases its history and an unused hidden group adds no empty legend.
 */
export function chartGroups(
  groups: ManpowerGroup[],
  plan: ManpowerValue[],
  actual: ManpowerValue[],
): ManpowerGroup[] {
  const used = new Set([...plan, ...actual].map((v) => v.groupId))
  return groups.filter((g) => !g.hidden || used.has(g.id)).sort(bySort)
}

/** The groups an entry form offers: visible ones, in sort order (R-8). */
export function entryGroups(groups: ManpowerGroup[]): ManpowerGroup[] {
  return groups.filter((g) => !g.hidden).sort(bySort)
}

/**
 * Each group's value on `day`. The GS form uses it to lock the cells that
 * already have a value: a GS fills empty cells only (R-7).
 */
export function valuesOnDay(values: ManpowerValue[], day: DayKey): Map<string, number> {
  const out = new Map<string, number>()
  for (const v of values) if (v.day === day) out.set(v.groupId, v.value)
  return out
}
