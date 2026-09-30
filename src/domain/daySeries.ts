import { dayRange } from './kpi'

/**
 * A per-day row, padded to every calendar day it did not have (QA F4).
 *
 * `efficiencySeries` and `hoursSeries` (domain/effort.ts) produce one row per
 * day that HAS data, which is right for the workbook and wrong for an axis:
 * Recharts spaces categories evenly, so 27/08, 30/08 and 05/09 sat side by
 * side and the line joined 30/08 to 05/09 across five days nobody worked --
 * the same defect the KPI chart had before RV5-37. This walks `dayRange` from
 * the first row's day to the last's and puts a row of nulls on every day in
 * between, so the axis is a calendar and a null is a gap in the line, not a
 * slope.
 *
 * The rows that were there come through untouched, so nothing that reads the
 * workbook's shapes changes; only the charts pad. Sorted by day first, so a
 * caller's insertion order cannot decide where the axis starts.
 *
 * Constrained to a record rather than to `{ day: string }` because the
 * efficiency series is keyed by stage name and typed as one -- its `day` is
 * a string by construction (effort.ts), which is all this reads.
 */
export function padDays<T extends Record<string, unknown>>(
  series: T[],
): Array<{ [K in keyof T]: K extends 'day' ? string : T[K] | null }> {
  type Row = { [K in keyof T]: K extends 'day' ? string : T[K] | null }
  if (series.length === 0) return []
  const dayOf = (row: T) => String(row.day)
  const sorted = [...series].sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1 : 0))
  const byDay = new Map(sorted.map((row) => [dayOf(row), row]))
  const keys = new Set<string>()
  for (const row of sorted) {
    for (const key of Object.keys(row)) if (key !== 'day') keys.add(key)
  }
  return dayRange(dayOf(sorted[0]), dayOf(sorted[sorted.length - 1])).map((day) => {
    const present = byDay.get(day)
    if (present) return present as unknown as Row
    const blank: Record<string, string | null> = { day }
    for (const key of keys) blank[key] = null
    return blank as unknown as Row
  })
}
