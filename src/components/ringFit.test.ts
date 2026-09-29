import { describe, expect, it } from 'vitest'
import { fieldType, type } from '../theme'
import { DECK_RING, GS_RING, ROLLUP_RING, figureChord, figureFits, ringFigureStep, textWidthEstimate } from './ringFit'

/**
 * Widths Chromium draws with Be Vietnam Pro loaded, at 21/700 and the rings'
 * -0.028 em tracking (re-review, fix round 1). The app sets tabular-nums, so
 * `.` and `,` take about a digit's width.
 */
const REAL_21_700: Record<string, number> = {
  '2.880,00': 95.7,
  '3.250,00': 96.2,
  '9.999,99': 97.8,
  '880,00': 75.9,
  '99,99%': 80.8,
  '86,39%': 79.8,
  '100,00%': 89.3,
  '123.456,78': 116.4,
}

describe('textWidthEstimate (I-2, RR-M1)', () => {
  it.each(Object.entries(REAL_21_700))('reads %s within 4 px of the real web font', (text, real) => {
    expect(Math.abs(textWidthEstimate(text, 21, -0.028) - real)).toBeLessThanOrEqual(4)
  })

  it('scales with the size and counts a separator as a digit, % wider', () => {
    expect(textWidthEstimate('1.000', 20)).toBeCloseTo(textWidthEstimate('1.000', 10) * 2)
    expect(textWidthEstimate('1,0', 10)).toBeCloseTo(textWidthEstimate('100', 10))
    expect(textWidthEstimate('%', 10)).toBeGreaterThan(textWidthEstimate('0', 10))
  })
})

describe('real clearance (RR-M1)', () => {
  it.each(['99,99%', '100,00%'])('leaves %s at least 4 px of the deck ring either side at displaySm', (text) => {
    expect(ringFigureStep(text, [type.displaySm, type.cardTitle, type.bodyStrong], DECK_RING)).toBe(type.displaySm)
    expect((figureChord(type.displaySm, DECK_RING) - REAL_21_700[text]) / 2).toBeGreaterThanOrEqual(4)
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
    expect(figureFits('888888', type.displaySm, centred)).toBe(true)
    expect(figureFits('888888', type.displaySm, pushed)).toBe(false)
  })

  it('falls back to the smallest step rather than to nothing', () => {
    expect(ringFigureStep('888.888.888,88', steps, ROLLUP_RING)).toBe(type.bodyStrong)
  })
})
