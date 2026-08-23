import { describe, expect, it } from 'vitest'
import { WORKBOOK_STAGES } from './fixtures'
import {
  buildStageSlices, NOT_STARTED_KEY, UNMAPPED_KEY,
} from './pieSlices'

/** A deck declaring 1000 m² whose cells cover 600. Openings and the E-house are
 *  not cells (spec §3.2), so the 400 m² gap is normal, not a data error. */
const TOTAL = 1000
const CELLS = [
  { areaM2: 300, stageId: 'coat1' },
  { areaM2: 200, stageId: 'coat2' },
  { areaM2: 100, stageId: null },
]

const areaOf = (slices: { key: string; areaM2: number }[], key: string) =>
  slices.find((s) => s.key === key)?.areaM2

describe('buildStageSlices', () => {
  it('gives one slice per stage, holding the area sitting AT that stage', () => {
    const slices = buildStageSlices(TOTAL, CELLS, WORKBOOK_STAGES)
    // Current stage, not cumulative: coat1 is 300, not 500. The cumulative
    // figures belong to the spec table (A_i), and mixing the two would make
    // the pie's slices sum to more than the deck.
    expect(areaOf(slices, 'coat1')).toBe(300)
    expect(areaOf(slices, 'coat2')).toBe(200)
    expect(areaOf(slices, 'coat3')).toBe(0)
  })

  it('keeps the stages in seq order, whatever order they arrive in', () => {
    const slices = buildStageSlices(TOTAL, CELLS, [...WORKBOOK_STAGES].reverse())
    expect(slices.map((s) => s.key)).toEqual([
      'coat1', 'coat2', 'coat3', 'coat4', 'scaffold', NOT_STARTED_KEY, UNMAPPED_KEY,
    ])
  })

  it('collects cells with no stage into a not-started slice', () => {
    expect(areaOf(buildStageSlices(TOTAL, CELLS, WORKBOOK_STAGES), NOT_STARTED_KEY)).toBe(100)
  })

  it('counts a cell pointing at a stage that no longer exists as not started', () => {
    // Matches stageSeqOf and nextStage. Without this the cell's area vanishes
    // from the pie while still counting in total_area_m2, and the slices stop
    // summing to the deck.
    const slices = buildStageSlices(
      TOTAL,
      [...CELLS, { areaM2: 50, stageId: 'deleted-stage' }],
      WORKBOOK_STAGES,
    )
    expect(areaOf(slices, NOT_STARTED_KEY)).toBe(150)
  })

  it('exposes the deck area its cells do not cover as an unmapped slice', () => {
    // The literal 400 is derived from the fixture's DECLARATION (1000 total,
    // 300 + 200 + 100 of cells), not recomputed from the output. An assertion
    // shaped `unmapped === total - sum(other slices)` is a tautology that holds
    // for every implementation, including one that returns 0.
    expect(areaOf(buildStageSlices(TOTAL, CELLS, WORKBOOK_STAGES), UNMAPPED_KEY)).toBe(400)
  })

  it('makes the slices sum to the deck\'s declared area', () => {
    const slices = buildStageSlices(TOTAL, CELLS, WORKBOOK_STAGES)
    // 1000 is the literal the deck declares. This is the assertion that makes
    // the pie and the headline percentage share a denominator: recharts derives
    // each slice's share from the sum of the data it is given, so the sum has
    // to BE the denominator.
    expect(slices.reduce((sum, s) => sum + s.areaM2, 0)).toBe(1000)
  })

  it('leaves each slice\'s share of the deck at its true value', () => {
    const slices = buildStageSlices(TOTAL, CELLS, WORKBOOK_STAGES)
    const coat1 = slices.find((s) => s.key === 'coat1')
    // 300 / 1000 = 0.3. An implementation that renormalises over the cells'
    // 600 m² reports 0.5 here -- and 0.5 is exactly what the pie would draw.
    expect((coat1?.areaM2 ?? 0) / TOTAL).toBe(0.3)
  })

  it('omits the unmapped slice when the cells cover the deck exactly', () => {
    const slices = buildStageSlices(600, CELLS, WORKBOOK_STAGES)
    expect(slices.some((s) => s.key === UNMAPPED_KEY)).toBe(false)
    expect(slices.reduce((sum, s) => sum + s.areaM2, 0)).toBe(600)
  })

  it('omits the unmapped slice when the cells over-cover the deck', () => {
    // A real state: the deck editor's >5% divergence banner is non-blocking
    // (spec §11), so a deck can be saved with cells summing above its declared
    // area. There is no negative slice to draw, so the pie renormalises here
    // and disagrees with the headline -- disclosed rather than hidden, and the
    // divergence banner in the deck editor is what catches the cause.
    const slices = buildStageSlices(400, CELLS, WORKBOOK_STAGES)
    expect(slices.some((s) => s.key === UNMAPPED_KEY)).toBe(false)
  })

  it('reports the whole deck as unmapped when it has no cells', () => {
    const slices = buildStageSlices(TOTAL, [], WORKBOOK_STAGES)
    expect(areaOf(slices, UNMAPPED_KEY)).toBe(1000)
    expect(areaOf(slices, NOT_STARTED_KEY)).toBe(0)
  })

  it('carries each stage\'s own colour and name', () => {
    const slices = buildStageSlices(TOTAL, CELLS, WORKBOOK_STAGES)
    expect(slices.find((s) => s.key === 'coat3')).toEqual({
      key: 'coat3', label: 'Coat 3', areaM2: 0, color: '#52c41a',
    })
  })
})
