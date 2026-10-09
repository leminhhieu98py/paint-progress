/**
 * A Piping quantity on screen (plan, actual, counts): vi-VN, up to two
 * decimals, no padding -- "1.022", "2,5", "22,75". One formatter for the
 * cells, the summary, the import preview and the chart tooltips.
 */
const QTY = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })

export const formatQty = (n: number): string => QTY.format(n)
