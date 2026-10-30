import { parseDecimalText } from '../../domain/piping/imports'

/**
 * A Piping quantity on screen (plan, actual, counts): vi-VN, up to two
 * decimals, no padding -- "1.022", "2,5", "22,75". One formatter for the
 * cells, the summary, the import preview and the chart tooltips.
 */
const QTY = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })

export const formatQty = (n: number): string => QTY.format(n)

/**
 * A number extra column's value (RV9-1): stored as a plain decimal
 * ("12.345"), which a vi reader takes for twelve thousand, so shown as a
 * quantity ("12,35"); text that is not a number is shown as it is.
 */
export function formatColumnNumber(text: string): string {
  const n = parseDecimalText(text)
  return n === null ? text : formatQty(n)
}
