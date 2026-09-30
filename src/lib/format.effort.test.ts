import { describe, expect, it } from 'vitest'
import { formatHours, formatMhrPerM2 } from './format'

describe('formatHours', () => {
  it('prints two decimals always, so a column of hours reads at one width (M11)', () => {
    expect(formatHours(3)).toBe('3,00')
    expect(formatHours(3.5)).toBe('3,50')
    expect(formatHours(0.25)).toBe('0,25')
    expect(formatHours(411.62)).toBe('411,62')
    expect(formatHours(1444)).toBe('1.444,00')
  })
})

describe('formatMhrPerM2', () => {
  it('prints three places, as the customer\'s workbook compares them', () => {
    expect(formatMhrPerM2(1.2016900772430186)).toBe('1,202')
    expect(formatMhrPerM2(1.1)).toBe('1,100')
  })
})
