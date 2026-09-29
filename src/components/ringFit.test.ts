import { describe, expect, it } from 'vitest'
import { fieldType, type } from '../theme'
import { DECK_RING, GS_RING, ROLLUP_RING, figureFits, ringFigureStep, textWidthEstimate } from './ringFit'

describe('textWidthEstimate (I-2)', () => {
  it('reads a figure at least as wide as Chrome drew it', () => {
    // Measured in Chromium at 21/700, -0.028em: "2.880,00" is 88.7 px.
    const w = textWidthEstimate('2.880,00', 21, -0.028)
    expect(w).toBeGreaterThanOrEqual(88.7)
    expect(w).toBeLessThan(100)
  })

  it('scales with the size and counts separators as narrow', () => {
    expect(textWidthEstimate('1.000', 20)).toBeCloseTo(textWidthEstimate('1.000', 10) * 2)
    expect(textWidthEstimate('1,0', 10)).toBeLessThan(textWidthEstimate('100', 10))
  })
})

describe('ringFigureStep (I-2)', () => {
  const steps = [type.displaySm, type.cardTitle, type.bodyStrong] as const

  it('keeps the largest step when the figure fits', () => {
    expect(ringFigureStep('86,39%', steps, DECK_RING)).toBe(type.displaySm)
  })

  it('steps down for a figure the hole cannot take at the largest size', () => {
    const step = ringFigureStep('2.880,00', [fieldType.displaySm, fieldType.cardTitle, fieldType.bodyStrong], GS_RING)
    expect(step).not.toBe(fieldType.displaySm)
    expect(figureFits('2.880,00', step, GS_RING)).toBe(true)
  })

  it.each([
    ['GS coat ring', GS_RING, '123.456,78', [fieldType.displaySm, fieldType.cardTitle, fieldType.bodyStrong]],
    ['admin deck ring', DECK_RING, '100,00%', steps],
    ['project rollup ring', ROLLUP_RING, '100,00%', steps],
  ] as const)('fits the widest figure of the %s with 4 px either side', (_, ring, text, s) => {
    const step = ringFigureStep(text, s, ring)
    expect(figureFits(text, step, ring)).toBe(true)
  })

  it('fits within the chord at the figure\'s own height, not only the diameter', () => {
    // A line pushed off the centre by the lines under it has less width.
    const centred = { holeDiameter: 90, above: 0, below: 0, letterSpacingEm: 0 }
    const pushed = { ...centred, below: 40 }
    expect(figureFits('88888', type.displaySm, centred)).toBe(true)
    expect(figureFits('88888', type.displaySm, pushed)).toBe(false)
  })

  it('falls back to the smallest step rather than to nothing', () => {
    expect(ringFigureStep('888.888.888,88', steps, ROLLUP_RING)).toBe(type.bodyStrong)
  })
})
