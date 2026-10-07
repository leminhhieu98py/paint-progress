/**
 * The one text order of the Piping module: Vietnamese collation, numeric
 * ("TP2" before "TP10"), case- and accent-blind. One shared collator, built
 * once: `localeCompare` with options builds one per call, which is an order
 * of magnitude slower when sorting 20 000 LineNo values on a phone.
 */
const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' })

export function compareText(a: string, b: string): number {
  return collator.compare(a, b)
}
