/** A series as a chart test's stand-in prints it: its data key and its legend name. */
export interface DrawnSeries {
  dataKey: string
  value: string
}

/**
 * The legend's names in the order Recharts 3 lists them: sorted by the
 * Legend's `itemSorter` (a function's rank, or a payload field; undefined is
 * Recharts' default, `'value'`, i.e. by name), stably; null keeps the payload's
 * order. The chart tests stand Recharts in, so this replays its sort on the
 * series the chart drew.
 */
export function legendNames(series: DrawnSeries[], itemSorter: unknown): string[] {
  const sorter = itemSorter === undefined ? 'value' : itemSorter
  if (sorter === null) return series.map((s) => s.value)
  const rank = typeof sorter === 'function'
    ? (s: DrawnSeries) => (sorter as (item: DrawnSeries) => number | string)(s)
    : (s: DrawnSeries) => s[sorter as keyof DrawnSeries]
  return series
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : a.i - b.i))
    .map(({ s }) => s.value)
}
