import { describe, expect, it } from 'vitest'
import { WORKBOOK_DECKS, WORKBOOK_STAGES, deckFromCumulative } from './fixtures'
import { computeDeckProgress, computeProjectProgress, stageSeqOf } from './progress'
import type { Stage } from './types'

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

  it('uses totalAreaM2 as the denominator, not the sum of cell areas', () => {
    const deck = deckFromCumulative('X', 'X', 1000, [500, 0, 0, 0, 0], stages)
    // only 500 m² of cells reach stage 1; the deck still measures 1000 m²
    expect(computeDeckProgress(deck, stages).stages[0].ratio).toBeCloseTo(0.5, 12)
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
