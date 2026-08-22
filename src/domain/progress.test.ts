import { describe, expect, it } from 'vitest'
import { WORKBOOK_DECKS, WORKBOOK_STAGES, deckFromCumulative } from './fixtures'
import { computeDeckProgress, computeProjectProgress, stageSeqOf } from './progress'
import type { Deck, Stage } from './types'

const stages: Stage[] = WORKBOOK_STAGES

describe('stageSeqOf', () => {
  it('returns 0 for a cell that has not started', () => {
    expect(stageSeqOf(stages, null)).toBe(0)
  })

  it('returns the stage seq for a known stage id', () => {
    expect(stageSeqOf(stages, 'coat3')).toBe(3)
  })

  it('returns 0 for an unknown stage id rather than throwing', () => {
    expect(stageSeqOf(stages, 'nope')).toBe(0)
  })
})

describe('computeDeckProgress — golden fixture from THEO DÕI CÔNG VIỆC CPP-TS.xlsx', () => {
  const expected: Record<string, number> = {
    SCD: 0.066807790008467,
    CD: 0.599552044306890,
    MEZZ: 0.501091297163316,
    MD: 0.479181325473044,
    WD: 0.455505210693249,
  }

  for (const deck of WORKBOOK_DECKS) {
    it(`reproduces the sheet's % Progress for ${deck.name}`, () => {
      const result = computeDeckProgress(deck, stages)
      expect(result.progress).toBeCloseTo(expected[deck.code], 9)
    })
  }

  it('reproduces the cumulative stage areas for Cellar Deck', () => {
    const cd = WORKBOOK_DECKS.find((d) => d.code === 'CD')!
    const areas = computeDeckProgress(cd, stages).stages.map((s) => s.cumulativeAreaM2)
    expect(areas).toEqual([5571, 5511, 2922.5, 2922.5, 0])
  })

  it('reproduces the sheet ratio for Cellar Deck Blast+Coat 1', () => {
    const cd = WORKBOOK_DECKS.find((d) => d.code === 'CD')!
    expect(computeDeckProgress(cd, stages).stages[0].ratio).toBeCloseTo(0.90747678775044793, 12)
  })

  it('divides by totalAreaM2 even when cells cover only part of the deck', () => {
    // Built as a literal on purpose: deckFromCumulative always emits a
    // leftover not-started cell, so every deck it builds has
    // sum(cell.areaM2) === totalAreaM2 and cannot distinguish the two
    // denominators. Real decks under-cover: openings and the E-house are
    // not cells at all.
    const deck: Deck = {
      id: 'partial',
      code: 'PART',
      name: 'Partially mapped deck',
      totalAreaM2: 1000,
      cells: [
        { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0, h: 0, areaM2: 500, stageId: 'coat1' },
      ],
    }
    const result = computeDeckProgress(deck, stages)
    // 500 of 1000 m² reached stage 1. A sum-of-cells denominator would say 1.0.
    expect(result.stages[0].ratio).toBeCloseTo(0.5, 12)
    expect(result.progress).toBeCloseTo(0.25 * 0.5, 12)
  })

  it('returns zero ratios for a deck with no area rather than dividing by zero', () => {
    const deck = deckFromCumulative('Z', 'Z', 0, [0, 0, 0, 0, 0], stages)
    const result = computeDeckProgress(deck, stages)
    expect(result.progress).toBe(0)
    expect(result.stages.every((s) => s.ratio === 0)).toBe(true)
  })
})

describe('computeProjectProgress', () => {
  it("reproduces the sheet's project rollup", () => {
    expect(computeProjectProgress(WORKBOOK_DECKS, stages).progress).toBeCloseTo(0.4846025, 6)
  })

  it('weights each deck by its share of total area', () => {
    const cd = computeProjectProgress(WORKBOOK_DECKS, stages).decks.find(
      (d) => d.deckId === 'CD',
    )!
    expect(cd.weight).toBeCloseTo(0.30728494058524, 11)
  })

  it('returns zero for an empty project', () => {
    expect(computeProjectProgress([], stages).progress).toBe(0)
  })
})

describe('deckFromCumulative', () => {
  it('rejects a non-monotonic cumulative array', () => {
    expect(() => deckFromCumulative('BAD', 'Bad', 100, [10, 20, 0, 0, 0], stages)).toThrow(
      /non-increasing/,
    )
  })

  it('rejects a cumulative array shorter than the stage list', () => {
    // Without this guard the missing entries yield areaM2: NaN, which the
    // `<= 0` push guard does not filter, silently poisoning a fixture.
    expect(() => deckFromCumulative('SHORT', 'Short', 100, [10, 5], stages)).toThrow(
      /one entry per stage/,
    )
  })
})
