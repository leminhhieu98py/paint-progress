import { describe, expect, it } from 'vitest'
import {
  parseViDecimal, parseViInteger, viAreaInputProps, viIntegerInputProps, viNumberInputProps,
} from './viNumberInput'

describe('parseViDecimal', () => {
  it('reads a comma as the decimal point', () => {
    expect(parseViDecimal('2,5')).toBe('2.5')
    expect(parseViDecimal('0,7')).toBe('0.7')
    expect(parseViDecimal(',5')).toBe('.5')
  })

  it('reads every dot as a thousands separator once a comma is present', () => {
    expect(parseViDecimal('1.230,5')).toBe('1230.5')
    expect(parseViDecimal('1.234.567,89')).toBe('1234567.89')
  })

  it('reads a single dot with no comma as the decimal point, as a mobile keypad sends it', () => {
    expect(parseViDecimal('2.5')).toBe('2.5')
    // The documented trade-off: without a comma there is no way to tell
    // "1.230" the thousand from "1.230" the decimal, and a keypad that only
    // offers "." makes the decimal the likelier meaning.
    expect(parseViDecimal('1.230')).toBe('1.230')
  })

  it('reads several dots with no comma as thousands separators', () => {
    expect(parseViDecimal('1.234.567')).toBe('1234567')
  })

  it('drops whitespace, including the narrow and non-breaking spaces Intl puts in', () => {
    expect(parseViDecimal(' 1 230,5 ')).toBe('1230.5')
    expect(parseViDecimal('1 230,5')).toBe('1230.5')
    expect(parseViDecimal('1 230,5')).toBe('1230.5')
  })

  it('keeps the sign', () => {
    expect(parseViDecimal('-2,5')).toBe('-2.5')
  })

  it('leaves an empty field empty, so a cleared input reads as no value and not as 0', () => {
    expect(parseViDecimal('')).toBe('')
    expect(parseViDecimal(undefined)).toBe('')
  })

  it('does not guess at two commas: the text stays unparseable', () => {
    expect(Number(parseViDecimal('1,2,3'))).toBeNaN()
  })

  it('accepts what the field itself displays after a blur', () => {
    // rc-input-number's own formatter, given decimalSeparator=",", renders
    // 1230.5 as "1230,5" -- no grouping -- and that must read back unchanged.
    expect(Number(parseViDecimal('1230,5'))).toBe(1230.5)
    expect(Number(parseViDecimal('0,60'))).toBe(0.6)
  })
})

describe('parseViDecimal on an English-format paste', () => {
  it('reads comma thousands before a single decimal dot as English', () => {
    // A figure pasted from an en-US spreadsheet: under the vi rule the comma
    // would be the decimal point and "1,230.5" would read as 1.2305.
    expect(parseViDecimal('1,230.5')).toBe('1230.5')
    expect(parseViDecimal('1,234,567.89')).toBe('1234567.89')
    expect(parseViDecimal('1,230.5', { thousandsDot: true })).toBe('1230.5')
  })

  it('only when the commas are real thousands groups', () => {
    // "2,5." is a stray dot after a vi decimal, not English.
    expect(Number(parseViDecimal('2,5.'))).toBe(2.5)
    // Nor is "1,500." -- a vi 1,5 with three decimals and a stray dot, or
    // an English paste still being typed. Only a digit after the dot says
    // English.
    expect(Number(parseViDecimal('1,500.'))).toBe(1.5)
    expect(Number(parseViDecimal('1,500.', { thousandsDot: true }))).toBe(1.5)
    expect(parseViDecimal('1.230,5')).toBe('1230.5')
  })
})

describe('parseViInteger', () => {
  it('reads every dot as a thousands separator', () => {
    expect(parseViInteger('1.230')).toBe('1230')
    expect(parseViInteger('1.234.567')).toBe('1234567')
  })

  it('keeps only the whole part of a decimal comma instead of gluing the digits on', () => {
    expect(parseViInteger('2,5')).toBe('2')
    expect(parseViInteger('1.230,5')).toBe('1230')
  })

  it('leaves an empty field empty', () => {
    expect(parseViInteger('')).toBe('')
    expect(parseViInteger(undefined)).toBe('')
  })
})

describe('parseViDecimal with thousandsDot (area fields)', () => {
  const area = (t: string | undefined) => parseViDecimal(t, { thousandsDot: true })

  it('reads a dot before exactly three digits as thousands when there is no comma', () => {
    // The plan-area placeholder itself shows "8.000,00", and an area is
    // thousands of m2, so "8.000" means eight thousand here.
    expect(area('8.000')).toBe('8000')
    expect(area('12.345')).toBe('12345')
    expect(area('12.345.678')).toBe('12345678')
  })

  it('ignores the 0 a cleared field puts in front of the typing', () => {
    // Emptying a field whose onChange stores `n ?? 0` (the deck area) makes
    // the input show "0" at once, so what the admin types lands after it.
    expect(Number(area('06.000'))).toBe(6000)
    expect(Number(area('0.5'))).toBe(0.5)
  })

  it('still reads a dot before one or two digits as the decimal point', () => {
    expect(area('8.5')).toBe('8.5')
    expect(area('8.50')).toBe('8.50')
  })

  it('does not read a dot as thousands where the grouping is not a real one', () => {
    // A leading zero or a first group of four digits is not how anyone
    // groups thousands, so the dot stays the decimal point.
    expect(area('0.125')).toBe('0.125')
    expect(area('1234.567')).toBe('1234.567')
    expect(area('8.0000')).toBe('8.0000')
  })

  it('keeps the comma rule unchanged', () => {
    expect(area('8.000,5')).toBe('8000.5')
    expect(area('2,5')).toBe('2.5')
  })

  it('leaves the general rule alone when the option is off', () => {
    expect(parseViDecimal('8.000')).toBe('8.000')
    expect(parseViDecimal('8.000', { thousandsDot: false })).toBe('8.000')
  })
})

describe('the prop bundles', () => {
  it('shows decimals with a comma and parses with the vi rule', () => {
    expect(viNumberInputProps.decimalSeparator).toBe(',')
    expect(viNumberInputProps.parser('1.230,5')).toBe('1230.5')
  })

  it('reads area fields with the thousands dot and shows decimals with a comma', () => {
    expect(viAreaInputProps.decimalSeparator).toBe(',')
    expect(viAreaInputProps.parser('8.000')).toBe('8000')
    expect(viAreaInputProps.parser('8.5')).toBe('8.5')
  })

  it('gives no bundle a formatter: a grouped "3.300" edited to "3.3000" would read 3.3', () => {
    expect('formatter' in viAreaInputProps).toBe(false)
    expect('formatter' in viNumberInputProps).toBe(false)
    expect('formatter' in viIntegerInputProps).toBe(false)
  })

  it('keeps the general rule in the decimal bundle', () => {
    expect(viNumberInputProps.parser('8.000')).toBe('8.000')
  })

  it('pins integer fields to whole numbers', () => {
    expect(viIntegerInputProps.precision).toBe(0)
    expect(viIntegerInputProps.parser('1.230')).toBe('1230')
  })
})
