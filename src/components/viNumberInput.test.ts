import { describe, expect, it } from 'vitest'
import {
  parseViDecimal, parseViInteger, viIntegerInputProps, viNumberInputProps,
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

describe('the prop bundles', () => {
  it('shows decimals with a comma and parses with the vi rule', () => {
    expect(viNumberInputProps.decimalSeparator).toBe(',')
    expect(viNumberInputProps.parser('1.230,5')).toBe('1230.5')
  })

  it('pins integer fields to whole numbers', () => {
    expect(viIntegerInputProps.precision).toBe(0)
    expect(viIntegerInputProps.parser('1.230')).toBe('1230')
  })
})
