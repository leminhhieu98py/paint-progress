/**
 * Props that make antd's InputNumber read numbers the way a Vietnamese user
 * types them.
 *
 * Without a `parser`, rc-input-number strips every character that is not a
 * word character, "." or "-" -- so the decimal comma is deleted, not read:
 * "2,5" Mhr became 25, "0,7" of a weight became 7 and was clamped to 1, and
 * "1.230,5" became 1.2305. `decimalSeparator=","` on its own replaces the
 * comma but keeps the thousands dots, so "1.230,5" still never parses.
 *
 * The rule, for a decimal field (`parseViDecimal`):
 *  1. Whitespace is dropped (including the non-breaking and narrow spaces
 *     Intl puts in grouped numbers).
 *  2. If the text holds a ",", that comma is the decimal point and every "."
 *     is a thousands separator: "1.230,5" -> 1230.5, "2,5" -> 2.5.
 *  3. With no ",", a single "." is the decimal point, because that is the
 *     only key an iPad or Android numeric keypad may offer: "2.5" -> 2.5.
 *     Consequence: "1.230" in a decimal field reads as 1.23, not 1230. A
 *     user who means a thousand types "1230" or "1.230,0".
 *  4. With no "," and more than one ".", every "." is a thousands separator:
 *     "1.234.567" -> 1234567 (no decimal number has two points).
 *  5. More than one "," is left unparseable: the field keeps its last valid
 *     value rather than guessing.
 *
 * For an integer field (`parseViInteger`), a "." can only be a thousands
 * separator, so "1.230" -> 1230; a "," starts a fraction the field cannot
 * hold, so it and everything after it are dropped: "2,5" -> 2, never 25.
 *
 * Why no custom `formatter`: given `decimalSeparator`, rc-input-number's own
 * formatter already renders 2.5 as "2,5" (the comma the rest of the app
 * shows), and it leaves the text alone while the user is typing. A custom
 * formatter is re-run on every keystroke that changes the value and would
 * have to replicate that. It must also never group thousands without a
 * comma: a displayed "1.230" (the integer 1230) would read back as 1.23
 * under rule 3.
 *
 * The parsers return TEXT, not a number, although the prop's type says the
 * field's value type: rc-input-number hands the result to its own decimal
 * parser, and only a string keeps an emptied field ("" -> no value, null)
 * and unparseable text (-> ignored) apart from 0. The cast is the one antd's
 * own `parser` examples use.
 */

const WHITESPACE = /[\s  ]+/g
/** rc-input-number's own legacy clean-up: drops "$", "%", and the like. */
const NOT_NUMERIC = /[^\w.-]+/g
/** The same, but a second comma survives it, so rule 5 stays unparseable. */
const NOT_NUMERIC_OR_COMMA = /[^\w.,-]+/g

export function parseViDecimal(text: string | undefined): string {
  const s = (text ?? '').replace(WHITESPACE, '')
  let normalised: string
  if (s.includes(',')) {
    normalised = s.replace(/\./g, '').replace(',', '.')
  } else if ((s.match(/\./g) ?? []).length > 1) {
    normalised = s.replace(/\./g, '')
  } else {
    normalised = s
  }
  return normalised.replace(NOT_NUMERIC_OR_COMMA, '')
}

export function parseViInteger(text: string | undefined): string {
  const s = (text ?? '').replace(WHITESPACE, '').replace(/\./g, '')
  const comma = s.indexOf(',')
  return (comma === -1 ? s : s.slice(0, comma)).replace(NOT_NUMERIC, '')
}

type NumberParser = (text: string | undefined) => number

/** Spread onto every InputNumber that holds a decimal. */
export const viNumberInputProps = {
  decimalSeparator: ',',
  parser: parseViDecimal as unknown as NumberParser,
} as const

/** Spread onto every InputNumber that holds a whole number. */
export const viIntegerInputProps = {
  parser: parseViInteger as unknown as NumberParser,
  precision: 0,
} as const
