import { dayRange } from '../kpi'
import type { DayKey, ViewMode } from './types'

/**
 * Piping weeks and chart buckets (spec §3, Q4-Q6).
 *
 * Week k is the 7 days `[weekStart + 7k, weekStart + 7k + 6]`, k any integer:
 * a day before the start date falls in a negative week rather than being
 * dropped. Weeks are computed here, at display time, and never stored, so an
 * admin who moves the week start date moves every bucket and no data.
 *
 * Day keys are `YYYY-MM-DD` strings and the arithmetic runs at UTC noon, as
 * `domain/kpi.ts` does: noon is twelve hours from either edge of the day, so
 * no time zone or daylight-saving shift of the runtime can move a key. Pure:
 * no clock, the caller passes today's key.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

function utcNoon(day: DayKey): number {
  return new Date(`${day}T12:00:00Z`).getTime()
}

function keyOf(ms: number): DayKey {
  return new Date(ms).toISOString().slice(0, 10)
}

/** `day` moved by `n` calendar days (negative goes back). */
export function addDays(day: DayKey, n: number): DayKey {
  return keyOf(utcNoon(day) + n * MS_PER_DAY)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((utcNoon(to) - utcNoon(from)) / MS_PER_DAY)
}

/** The week `day` falls in, counted from `weekStart` (week 0). */
export function weekIndex(day: DayKey, weekStart: DayKey): number {
  return Math.floor(daysBetween(weekStart, day) / 7)
}

/** The first and last day of week `k`. */
export function weekRange(k: number, weekStart: DayKey): { start: DayKey; end: DayKey } {
  const start = addDays(weekStart, 7 * k)
  return { start, end: addDays(start, 6) }
}

/** `DD/MM`: the axis label of a day, and of a week by its first day (Q6A). */
export function formatDayMonth(day: DayKey): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`
}

/** `DD/MM/YYYY`, the day-view tooltip. */
function formatDayMonthYear(day: DayKey): string {
  return `${formatDayMonth(day)}/${day.slice(0, 4)}`
}

/** Week `k`'s axis label: its first day, `DD/MM`. */
export function weekLabel(k: number, weekStart: DayKey): string {
  return formatDayMonth(weekRange(k, weekStart).start)
}

/** Week `k`'s tooltip: `DD/MM – DD/MM` (en dash). */
export function weekRangeLabel(k: number, weekStart: DayKey): string {
  const { start, end } = weekRange(k, weekStart)
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`
}

/** One point on a chart's time axis: a day, or a week. */
export interface Bucket {
  /** The bucket's first day; unique across years, unlike the label. */
  key: DayKey
  start: DayKey
  end: DayKey
  /** Axis label, `DD/MM`. */
  label: string
  /** `DD/MM/YYYY` for a day, `DD/MM – DD/MM` for a week. */
  tooltip: string
}

/**
 * Every bucket from the one holding `from` to the one holding `to`.
 *
 * Week view rounds out to whole weeks, so the first and last bucket may hold
 * days outside the range. An inverted range yields the single bucket of
 * `from`, as `dayRange` does: one point is a safer axis than none.
 */
export function buckets(from: DayKey, to: DayKey, mode: ViewMode, weekStart: DayKey): Bucket[] {
  if (mode === 'day') {
    return dayRange(from, to).map((day) => ({
      key: day,
      start: day,
      end: day,
      label: formatDayMonth(day),
      tooltip: formatDayMonthYear(day),
    }))
  }
  const first = weekIndex(from, weekStart)
  const last = Math.max(first, weekIndex(to, weekStart))
  const out: Bucket[] = []
  for (let k = first; k <= last; k += 1) {
    const { start, end } = weekRange(k, weekStart)
    out.push({ key: start, start, end, label: weekLabel(k, weekStart), tooltip: weekRangeLabel(k, weekStart) })
  }
  return out
}

/**
 * The days a chart's axis must cover: the first data day to the last, and on
 * to today when today is later, so an actual line can run flat up to today
 * ("actual to today", spec §0) and a stalled actual reads as stalled.
 *
 * Today never pulls the axis BACK: a plan that starts next month starts the
 * axis next month, and its actual series is simply all null. Null without data.
 */
export function seriesSpan(days: DayKey[], todayKey: DayKey): { from: DayKey; to: DayKey } | null {
  if (days.length === 0) return null
  let from = days[0]
  let to = days[0]
  for (const day of days) {
    if (day < from) from = day
    if (day > to) to = day
  }
  if (todayKey > to) to = todayKey
  return { from, to }
}
