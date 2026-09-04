import { describe, expect, it } from 'vitest'
import { formatHours, formatMhrPerM2 } from './format'

describe('formatHours', () => {
  it('keeps one decimal always and a second only when it says something', () => {
    expect(formatHours(3)).toBe('3,0')
    expect(formatHours(3.5)).toBe('3,5')
    expect(formatHours(0.25)).toBe('0,25')
    expect(formatHours(1444)).toBe('1.444,0')
  })
})

describe('formatMhrPerM2', () => {
  it('prints three places, as the customer\'s workbook compares them', () => {
    expect(formatMhrPerM2(1.2016900772430186)).toBe('1,202')
    expect(formatMhrPerM2(1.1)).toBe('1,100')
  })
})
