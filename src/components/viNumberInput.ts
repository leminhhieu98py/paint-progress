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
 *  6. The one exception to rule 2: comma thousands groups before a single
 *     dot are an English-format paste (an en-US spreadsheet): "1,230.5" ->
 *     1230.5, "1,234,567.89" -> 1234567.89. Only well-formed groups count,
 *     so a stray dot after a vi decimal, "2,5.", still reads 2.5.
 *
 * Area fields (`viAreaInputProps`, `thousandsDot: true`) change rule 3 only.
 * Their values are thousands of m2 and the plan-area placeholder itself
 * reads "8.000,00", so with no "," a dot before exactly three digits, in a
 * real grouping (a first group of 1-3 digits not starting with 0, then
 * groups of three), is a thousands separator: "8.000" -> 8000,
 * "12.345.678" -> 12345678. Anything else keeps rule 3: "8.5" and "8.50"
 * -> 8.5, "0.125" -> 0.125, "1234.567" -> 1234.567. Hours, weights and %
 * keep the general rule: "1.500" Mhr is 1.5 there.
 *
 * For an integer field (`parseViInteger`), a "." can only be a thousands
 * separator, so "1.230" -> 1230; a "," starts a fraction the field cannot
 * hold, so it and everything after it are dropped: "2,5" -> 2, never 25.
 *
 * Display. Hours, weights and % use rc-input-number's own formatter, which,
 * given `decimalSeparator`, renders 2.5 as "2,5" and never groups. They
 * must never group: a displayed "1.230" (the integer 1230) would read back
 * as 1.23 under rule 3. Area fields do group, with `formatViGrouped` --
 * 8000.5 shows as "8.000,5", like their placeholder and the rest of the
 * app -- which is safe only because the area parser reads a grouped dot as
 * thousands and the formatter always writes a decimal with a comma. Like
 * rc's own, it leaves the text alone while the user is typing.
 *
 * The parsers return TEXT, not a number, although the prop's type says the
 * field's value type: rc-input-number hands the result to its own decimal
 * parser, and only a string keeps an emptied field ("" -> no value, null)
 * and unparseable text (-> ignored) apart from 0. The cast is the one antd's
 * own `parser` examples use.
 */

/** `\s` covers the non-breaking (U+00A0) and narrow (U+202F) spaces Intl uses. */
const WHITESPACE = /\s+/g
/** rc-input-number's own legacy clean-up: drops "$", "%", and the like. */
const NOT_NUMERIC = /[^\w.-]+/g
/** The same, but a second comma survives it, so rule 5 stays unparseable. */
const NOT_NUMERIC_OR_COMMA = /[^\w.,-]+/g

/** "8.000", "12.345.678": thousands grouping with no decimal part. */
const GROUPED_THOUSANDS = /^-?[1-9]\d{0,2}(\.\d{3})+$/
/** "1,230.5", "1,234,567.89": rule 6. */
const ENGLISH_FORMAT = /^-?\d{1,3}(,\d{3})+\.\d*$/
/**
 * Zeros before another digit. A field whose onChange stores `n ?? 0` shows
 * "0" the moment it is emptied, so "8.000" typed next arrives as "08.000".
 */
const LEADING_ZEROS = /^(-?)0+(?=\d)/

export function parseViDecimal(
  text: string | undefined,
  options: { thousandsDot?: boolean } = {},
): string {
  const s = (text ?? '').replace(WHITESPACE, '')
  let normalised: string
  if (ENGLISH_FORMAT.test(s)) {
    normalised = s.replace(/,/g, '')
  } else if (s.includes(',')) {
    normalised = s.replace(/\./g, '').replace(',', '.')
  } else if ((s.match(/\./g) ?? []).length > 1
    || (options.thousandsDot === true && GROUPED_THOUSANDS.test(s.replace(LEADING_ZEROS, '$1')))) {
    normalised = s.replace(/\./g, '')
  } else {
    normalised = s
  }
  return normalised.replace(NOT_NUMERIC_OR_COMMA, '')
}

/**
 * The display for area fields: dots between thousands, a comma before the
 * decimals, the value's own digits otherwise (no rounding, no padding).
 */
export function formatViGrouped(
  value: string | number | undefined,
  info: { userTyping: boolean; input: string },
): string {
  if (info.userTyping) return info.input
  const str = value === undefined ? '' : String(value)
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(str)
  if (m === null) return str
  const whole = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${m[1]}${whole}${m[3] === undefined ? '' : `,${m[3]}`}`
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

/** Spread onto an InputNumber that holds an area: see the thousandsDot rule. */
export const viAreaInputProps = {
  decimalSeparator: ',',
  parser: ((text: string | undefined) => parseViDecimal(text, { thousandsDot: true })) as unknown as NumberParser,
  formatter: formatViGrouped,
} as const

/** Spread onto every InputNumber that holds a whole number. */
export const viIntegerInputProps = {
  parser: parseViInteger as unknown as NumberParser,
  precision: 0,
} as const
