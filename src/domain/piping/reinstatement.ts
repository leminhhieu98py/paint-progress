import { barCumSeries, sumByDay, type BarCumPoint } from './series'
import type { DayKey, ReinstatementActualEntry, ReinstatementPlanRow, ViewMode } from './types'
import { buckets, seriesSpan } from './week'

/**
 * Reinstatement -- requirement §4.1, spec §4, Q8-Q10.
 *
 * The plan is one row per day (daily or weekly rows, Q4C); the actual is a list
 * of append-only entries that add up per day (R-3). The chart is bars Plan and
 * Actual per day/week, a Plan cumulative line to the end of the plan and an
 * Actual cumulative line to today (R-5). Pure: the caller passes today's key.
 */

export type ReinstatementPoint = BarCumPoint

/** The chart rows; empty with neither plan nor actual. */
export function reinstatementSeries(input: {
  plan: ReinstatementPlanRow[]
  actual: Array<Pick<ReinstatementActualEntry, 'day' | 'qty'>>
  mode: ViewMode
  weekStart: DayKey
  todayKey: DayKey
}): ReinstatementPoint[] {
  const plan = sumByDay(input.plan.map((r) => ({ day: r.day, value: r.planQty })))
  const actual = sumByDay(input.actual.map((e) => ({ day: e.day, value: e.qty })))
  const span = seriesSpan([...plan.keys(), ...actual.keys()], input.todayKey)
  if (span === null) return []
  const planDays = [...plan.keys()]
  return barCumSeries({
    buckets: buckets(span.from, span.to, input.mode, input.weekStart),
    plan,
    actual,
    planEnd: planDays.length > 0 ? planDays[planDays.length - 1] : null,
    todayKey: input.todayKey,
  })
}

/** `Reinstatement: 235/1022 – 22,99% TestPack` as numbers. */
export interface ReinstatementSummary {
  actual: number
  total: number | null
  /** actual / total, 0..1; null without a positive total. */
  ratio: number | null
}

export function reinstatementSummary(
  actual: Array<Pick<ReinstatementActualEntry, 'qty'>>,
  totalTestPacks: number | null,
): ReinstatementSummary {
  const sum = actual.reduce((acc, e) => acc + e.qty, 0)
  return {
    actual: sum,
    total: totalTestPacks,
    ratio: totalTestPacks !== null && totalTestPacks > 0 ? sum / totalTestPacks : null,
  }
}

const viNumber = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })

/**
 * Why an entry cannot be saved, or null when it can -- the rules of
 * `piping_add_reinstatement` and the table's trigger (spec §4), checked on
 * screen before the round trip. The database enforces the same rules; this
 * only spares the user a failed save.
 *
 * `editing` is the stored entry an admin is correcting. As the trigger does,
 * the cap applies to an edit only when it RAISES the stored quantity, and then
 * without the entry itself in the cumulative: lowering a quantity, keeping it
 * or moving its day always passes, so an admin can correct downwards even
 * after lowering the total below what was entered.
 */
export function checkReinstatementEntry(input: {
  entries: Array<Pick<ReinstatementActualEntry, 'id' | 'qty'>>
  totalTestPacks: number | null
  day: DayKey
  qty: number
  todayKey: DayKey
  editing?: { id: string; qty: number }
}): string | null {
  if (input.day > input.todayKey) return 'Ngày không được sau hôm nay'
  if (!(input.qty > 0)) return 'Số lượng phải lớn hơn 0'
  const { editing } = input
  if (editing !== undefined && input.qty <= editing.qty) return null
  if (input.totalTestPacks === null) return 'Admin chưa nhập tổng Test Pack'
  const already = input.entries
    .filter((e) => e.id !== editing?.id)
    .reduce((acc, e) => acc + e.qty, 0)
  if (already + input.qty > input.totalTestPacks) {
    return `Vượt tổng Test Pack (đã có ${viNumber.format(already)} / ${viNumber.format(input.totalTestPacks)})`
  }
  return null
}

/** A sum of quantities, rid of binary float noise (0.1 + 0.2 is 0.3 here, as in the database's numeric). */
export function sumQty(values: number[]): number {
  return Math.round(values.reduce((acc, v) => acc + v, 0) * 1e6) / 1e6
}

/**
 * Why an Actual import (RV8-6) cannot be written, or null -- the cap of
 * piping_import_reinstatement_actual (R-4, Q9A), checked on screen first: the
 * total must be set, and the cumulative AFTER the import (each file day's
 * entries replaced by its qty) must not exceed it.
 */
export function checkReinstatementActualImport(
  entries: Array<Pick<ReinstatementActualEntry, 'day' | 'qty'>>,
  rows: Array<{ day: DayKey; qty: number }>,
  totalTestPacks: number | null,
): string | null {
  if (totalTestPacks === null) return 'Admin chưa nhập tổng Test Pack'
  const fileDays = new Set(rows.map((r) => r.day))
  const after = sumQty([...entries.filter((e) => !fileDays.has(e.day)).map((e) => e.qty), ...rows.map((r) => r.qty)])
  if (after > totalTestPacks) {
    return `Vượt tổng Test Pack (đã có ${viNumber.format(after)} / ${viNumber.format(totalTestPacks)})`
  }
  return null
}
