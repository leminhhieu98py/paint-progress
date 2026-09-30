import { describe, expect, it } from 'vitest'
import { formatAxisNumber, formatAxisPercent } from './format'

describe('formatAxisNumber (R5-C2)', () => {
  it('reads an axis tick the Vietnamese way: decimal comma, thousands dot', () => {
    expect([1.05, 0.7, 0.35, 0].map(formatAxisNumber)).toEqual(['1,05', '0,7', '0,35', '0'])
    expect([1800, 1350, 2200, 10000].map(formatAxisNumber)).toEqual(['1.800', '1.350', '2.200', '10.000'])
  })

  it('stops at three decimals, and pads none a round tick does not need', () => {
    expect(formatAxisNumber(0.3333333)).toBe('0,333')
    expect(formatAxisNumber(12)).toBe('12')
  })

  it('keeps the precision a low-range step needs (CHT-03)', () => {
    // A Mhr/m² axis stepping by 0,025 read 0,03 · 0,05 · 0,08 at two places.
    expect([0, 0.025, 0.05, 0.075, 0.1].map(formatAxisNumber)).toEqual(['0', '0,025', '0,05', '0,075', '0,1'])
  })
})

describe('formatAxisPercent (CHT-03)', () => {
  it('reads a share tick as a percentage without padding, like the other axes', () => {
    expect([0, 0.25, 0.5, 1, 1.2].map(formatAxisPercent)).toEqual(['0%', '25%', '50%', '100%', '120%'])
    expect(formatAxisPercent(0.125)).toBe('12,5%')
  })
})
