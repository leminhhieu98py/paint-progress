import { describe, expect, it } from 'vitest'
import { WORKBOOK_DECKS, WORKBOOK_STAGES, deckFromCumulative } from './fixtures'
import {
  computeDeckProgress, computeProjectProgress, computeWorkProgress, stageSeqOf, summariseDeck,
} from './progress'
import type { Deck, Stage, Work, WorkModel } from './types'

const stages: Stage[] = WORKBOOK_STAGES

const work = (over: Partial<Work> = {}): Work => ({
  id: 'w1', projectId: 'p1', seq: 1, name: 'Công việc chính', kind: 'bays',
  weight: 1, counts: true, manualProgress: 0, ...over,
})

/** Every deck under one bays work of weight 1 with D = m² share -- what the
 *  0024 backfill creates for every existing project. */
const singleWork = (decks: Deck[]): WorkModel => {
  const total = decks.reduce((sum, d) => sum + d.totalAreaM2, 0)
  return {
    work: work(),
    decks: decks.map((deck) => ({ deck, stages, weight: total > 0 ? deck.totalAreaM2 / total : 0 })),
  }
}

/** The formula work items replace, kept as the reference the migration must
 *  reproduce: each deck weighted by its share of the project's declared area. */
function legacyProjectProgress(entries: { deck: Deck; stages: Stage[] }[]): number {
  const totalArea = entries.reduce((sum, e) => sum + e.deck.totalAreaM2, 0)
  return entries.reduce(
    (sum, e) =>
      sum + (totalArea > 0 ? e.deck.totalAreaM2 / totalArea : 0) * computeDeckProgress(e.deck, e.stages).progress,
    0,
  )
}

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

describe('computeWorkProgress', () => {
  it('weights each deck by its declared share within the work', () => {
    // Two decks, deliberately not weighted by area: D is the admin's number.
    const a = deckFromCumulative('A', 'A', 100, [50, 0, 0, 0, 0], stages)   // P = 0.25*0.5
    const b = deckFromCumulative('B', 'B', 100, [100, 100, 0, 0, 0], stages) // P = 0.25+0.15
    const result = computeWorkProgress({
      work: work(),
      decks: [{ deck: a, stages, weight: 0.7 }, { deck: b, stages, weight: 0.3 }],
    })
    expect(result.progress).toBeCloseTo(0.7 * 0.125 + 0.3 * 0.4, 12)
    expect(result.decks.map((d) => [d.deckId, d.weight])).toEqual([['A', 0.7], ['B', 0.3]])
  })

  it('is the typed percentage for a manual work', () => {
    // Marking, chứng từ, lên xà lan: no bays to colour, the admin types it.
    const result = computeWorkProgress({
      work: work({ kind: 'manual', manualProgress: 0.19 }), decks: [],
    })
    expect(result.progress).toBe(0.19)
    expect(result.decks).toEqual([])
  })

  it('is zero for a bays work that has no decks yet', () => {
    expect(computeWorkProgress({ work: work(), decks: [] }).progress).toBe(0)
  })
})

describe('computeProjectProgress', () => {
  it("reproduces the sheet's project rollup through one work of weight 1 with m² shares", () => {
    expect(computeProjectProgress([singleWork(WORKBOOK_DECKS)]).progress).toBeCloseTo(0.4846025, 6)
  })

  it('matches the formula it replaces to the last digit, on the migration shape', () => {
    // This is the promise 0024 makes: every existing percentage stays where
    // it was, because the backfill creates exactly this model.
    const entries = WORKBOOK_DECKS.map((deck) => ({ deck, stages }))
    expect(computeProjectProgress([singleWork(WORKBOOK_DECKS)]).progress)
      .toBeCloseTo(legacyProjectProgress(entries), 12)
  })

  it('still reports each deck\'s weight within its work', () => {
    const cd = computeProjectProgress([singleWork(WORKBOOK_DECKS)]).works[0].decks
      .find((d) => d.deckId === 'CD')!
    expect(cd.weight).toBeCloseTo(0.30728494058524, 11)
  })

  it('sums the counted works by weight and leaves the rest out of the total', () => {
    // Linh's example, Cellar Deck column: sơn .35 × .151, tháo giáo .35 × .166,
    // dọn dẹp .30 × .224; Marking is tracked but weight 0 / not counted.
    const result = computeProjectProgress([
      { work: work({ id: 'son', name: 'Sơn', kind: 'manual', weight: 0.35, manualProgress: 0.151 }), decks: [] },
      { work: work({ id: 'gg', name: 'Tháo giáo', kind: 'manual', weight: 0.35, manualProgress: 0.166 }), decks: [] },
      { work: work({ id: 'dd', name: 'Dọn dẹp', kind: 'manual', weight: 0.30, manualProgress: 0.224 }), decks: [] },
      { work: work({ id: 'mk', name: 'Marking', kind: 'manual', weight: 0, counts: false, manualProgress: 0.12 }), decks: [] },
    ])
    expect(result.progress).toBeCloseTo(0.35 * 0.151 + 0.35 * 0.166 + 0.30 * 0.224, 12)
    // Present, so the screens can show it, but not in the sum.
    expect(result.works.map((w) => [w.work.id, w.progress])).toEqual([
      ['son', 0.151], ['gg', 0.166], ['dd', 0.224], ['mk', 0.12],
    ])
  })

  it('returns zero for a project with no works', () => {
    expect(computeProjectProgress([]).progress).toBe(0)
  })
})

describe('summariseDeck', () => {
  // d1 is in work A (W .6, D .5) at 50% and in work B (W .4, D 1) at 100%.
  const oneCoat = (id: string): Stage[] => [{ id, seq: 1, name: id, color: '#000000', weight: 1 }]
  const d1ForA: Deck = {
    id: 'd1', code: 'D1', name: 'Deck 1', totalAreaM2: 100,
    cells: [{ id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0, h: 0, areaM2: 50, stageId: 'a1' }],
  }
  const d1ForB: Deck = {
    ...d1ForA,
    cells: [{ id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0, h: 0, areaM2: 100, stageId: 'b1' }],
  }
  const models: WorkModel[] = [
    { work: work({ id: 'A', weight: 0.6 }), decks: [{ deck: d1ForA, stages: oneCoat('a1'), weight: 0.5 }] },
    { work: work({ id: 'B', weight: 0.4 }), decks: [{ deck: d1ForB, stages: oneCoat('b1'), weight: 1 }] },
  ]

  it('averages the deck\'s per-work progress by W·D, and reports that weight', () => {
    const s = summariseDeck('d1', models)
    // (0.6·0.5)·0.5 + (0.4·1)·1  over  0.3 + 0.4
    expect(s.progress).toBeCloseTo((0.3 * 0.5 + 0.4 * 1) / 0.7, 12)
    expect(s.effectiveWeight).toBeCloseTo(0.7, 12)
    expect(s.perWork.map((p) => [p.work.id, p.weight, p.progress])).toEqual([['A', 0.5, 0.5], ['B', 1, 1]])
  })

  it('reads zero, with zero weight, for a deck in no counted work', () => {
    const s = summariseDeck('d1', [
      { work: work({ id: 'A', counts: false }), decks: [{ deck: d1ForA, stages: oneCoat('a1'), weight: 1 }] },
    ])
    expect(s.progress).toBe(0)
    expect(s.effectiveWeight).toBe(0)
    // Still listed: the deck IS in the work, the work just does not count.
    expect(s.perWork).toHaveLength(1)
  })

  it('reads zero for a deck in no work at all', () => {
    expect(summariseDeck('d9', models)).toEqual({ deckId: 'd9', progress: 0, effectiveWeight: 0, perWork: [] })
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
