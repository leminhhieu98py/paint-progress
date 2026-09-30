import { describe, expect, it } from 'vitest'
import { roundSharesToTotal } from './rounding'

// Two-decimal percentages are steps of 0.0001 as ratios.
const pct = (xs: number[]) => xs.map((x) => Math.round(x * 10000) / 100)

describe('roundSharesToTotal', () => {
  it('keeps the rounded shares adding up to the rounded total (dev, 2026-09-29)', () => {
    // Each rounds up on its own -- 12,66 + 12,03 + 0,44 = 25,13 -- under a
    // centre that reads 25,12: the legend seen on dev that day.
    const shares = [0.126551, 0.120251, 0.004351]
    const total = shares.reduce((s, x) => s + x, 0)
    const out = roundSharesToTotal(shares, total)
    expect(pct(out).reduce((s, x) => s + x, 0).toFixed(2)).toBe('25.12')
    expect(pct([total])[0]).toBe(25.12)
  })

  it('gives the missing step to the share with the largest remainder, not the first', () => {
    // .00015 + .00015 + .00070 = .00100: floors 1+1+7 = 9 steps, one short;
    // the remainders are .5, .5, 0 -- a tie broken by position, never the 0.
    expect(roundSharesToTotal([0.00015, 0.00015, 0.0007], 0.001)).toEqual([0.0002, 0.0001, 0.0007])
  })

  it('leaves shares that already add up untouched', () => {
    expect(roundSharesToTotal([0.2077, 0.1023, 0.1191], 0.4291)).toEqual([0.2077, 0.1023, 0.1191])
  })

  it('returns zeros for zeros and an empty list for an empty list', () => {
    expect(roundSharesToTotal([0, 0], 0)).toEqual([0, 0])
    expect(roundSharesToTotal([], 0)).toEqual([])
  })
})
