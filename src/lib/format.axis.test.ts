import { describe, expect, it } from 'vitest'
import { formatAxisNumber } from './format'

describe('formatAxisNumber (R5-C2)', () => {
  it('reads an axis tick the Vietnamese way: decimal comma, thousands dot', () => {
    expect([1.05, 0.7, 0.35, 0].map(formatAxisNumber)).toEqual(['1,05', '0,7', '0,35', '0'])
    expect([1800, 1350, 2200, 10000].map(formatAxisNumber)).toEqual(['1.800', '1.350', '2.200', '10.000'])
  })

  it('stops at two decimals, and pads none a round tick does not need', () => {
    expect(formatAxisNumber(0.3333333)).toBe('0,33')
    expect(formatAxisNumber(12)).toBe('12')
  })
})
