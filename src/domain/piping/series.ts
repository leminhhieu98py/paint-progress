import type { DayKey } from './types'
import type { Bucket } from './week'

/**
 * Bars and cumulative lines over a bucket axis (spec §3, §4, §6.4).
 *
 * The one rule every Piping chart shares, written once: a plan series runs to
 * the END OF THE PLAN and is null after it; an actual series runs to TODAY and
 * is null after it (spec §0). Reinstatement feeds quantities through it; CAM
 * feeds counts of spools or groups reaching a milestone on each day.
 */

/** An amount on a day. */
export interface DayAmount {
  day: DayKey
  value: number
}

/** Amounts added up per day; several on one day sum (R-3). */
export function sumByDay(amounts: DayAmount[]): Map<DayKey, number> {
  const out = new Map<DayKey, number>()
  const sorted = [...amounts].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  for (const { day, value } of sorted) out.set(day, (out.get(day) ?? 0) + value)
  return out
}

/** One bucket with the plan and actual bars and their running totals. */
export interface BarCumPoint extends Bucket {
  /** The plan inside the bucket; null after the plan's end. */
  plan: number | null
  /** The plan up to the bucket's last day; null after the plan's end. */
  planCum: number | null
  /** The actual inside the bucket up to today; null for a bucket after today. */
  actual: number | null
  /** The actual up to the bucket's last day or today, whichever is earlier. */
  actualCum: number | null
}

/**
 * A walk over the amounts in day order, asked for windows `[from, to]` that
 * only move forward (the buckets' order): each call answers the sum inside
 * the window and the running total up to `to`, both added day by day from
 * zero in day order. Every amount is visited once, so a series over B buckets
 * and D days costs O(B + D log D) rather than O(B x D) -- a typo year in a
 * plan gives thousands of day buckets.
 */
function forwardSums(byDay: Map<DayKey, number>) {
  const entries = [...byDay].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  let i = 0
  let running = 0
  return (from: DayKey, to: DayKey): { within: number; cum: number } => {
    while (i < entries.length && entries[i][0] < from) running += entries[i++][1]
    let within = 0
    while (i < entries.length && entries[i][0] <= to) {
      within += entries[i][1]
      running += entries[i++][1]
    }
    return { within, cum: running }
  }
}

/**
 * The bars and cumulative lines of a plan and an actual over `buckets`.
 *
 * `planEnd` is the plan's last day (null: no plan, every plan value null). It
 * is an argument rather than the last key of `plan` so that CAM can end all
 * three plan lines on the plan's overall last day.
 *
 * A bucket that starts after `planEnd` has no plan value; the bucket holding
 * `planEnd` carries the full total. A bucket that starts after `todayKey` has
 * no actual value; the bucket holding today counts up to today only (no actual
 * is ever after today -- the database refuses one -- so this is a guard).
 */
export function barCumSeries(input: {
  buckets: Bucket[]
  plan: Map<DayKey, number>
  actual: Map<DayKey, number>
  planEnd: DayKey | null
  todayKey: DayKey
}): BarCumPoint[] {
  const { planEnd, todayKey } = input
  const plan = forwardSums(input.plan)
  const actual = forwardSums(input.actual)
  // Buckets run forward and a bucket without a plan (or actual) value is
  // followed only by such buckets, so each walk is asked in order.
  return input.buckets.map((bucket) => {
    const hasPlan = planEnd !== null && bucket.start <= planEnd
    const hasActual = bucket.start <= todayKey
    const actualTo = bucket.end < todayKey ? bucket.end : todayKey
    const p = hasPlan ? plan(bucket.start, bucket.end) : null
    const a = hasActual ? actual(bucket.start, actualTo) : null
    return {
      ...bucket,
      plan: p === null ? null : p.within,
      planCum: p === null ? null : p.cum,
      actual: a === null ? null : a.within,
      actualCum: a === null ? null : a.cum,
    }
  })
}
