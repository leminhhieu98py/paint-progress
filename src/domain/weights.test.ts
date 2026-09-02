import { describe, expect, it } from 'vitest'
import { sumsToOne, WEIGHT_EPSILON } from './weights'

describe('sumsToOne', () => {
  it('accepts Linh\'s split', () => {
    expect(sumsToOne([0.35, 0.35, 0.3])).toBe(true)
  })

  it('tolerates binary rounding, since 0.1 + 0.2 is not 0.3 in a double', () => {
    expect(sumsToOne([0.1, 0.2, 0.7])).toBe(true)
    expect(sumsToOne([0.1, 0.1, 0.1, 0.7])).toBe(true)
  })

  it('refuses a real gap, however small it looks on screen', () => {
    // 0.9995 rounds to 1,00 at two decimals and is still a 0,05% hole in a
    // billed figure.
    expect(sumsToOne([0.5, 0.4995])).toBe(false)
    expect(sumsToOne([0.5, 0.4])).toBe(false)
  })

  it('refuses an empty list -- nothing sums to one', () => {
    expect(sumsToOne([])).toBe(false)
  })

  it('uses the same tolerance the stage weights always have', () => {
    expect(WEIGHT_EPSILON).toBe(1e-5)
  })
})
