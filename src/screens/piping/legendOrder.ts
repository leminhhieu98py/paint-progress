import type { LegendPayload } from 'recharts'

/**
 * A Legend `itemSorter` that lists the series in the order of `keys` (their
 * data keys). Recharts 3 sorts legend items by name by default, which put
 * "Actual …" before "Plan …"; the Piping charts list Plan before Actual, a
 * bar before a line.
 */
export function legendOrder(keys: readonly string[]): (item: LegendPayload) => number {
  return (item) => keys.indexOf(String(item.dataKey))
}
