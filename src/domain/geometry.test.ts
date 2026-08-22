import { describe, expect, it } from 'vitest'
import {
  AREA_DIVERGENCE_THRESHOLD,
  areaDivergence,
  buildMeshFromGuides,
  deriveCellArea,
  divergesBeyondThreshold,
  mergeCells,
  offsetsFromSpans,
  prorateCellAreas,
  spansFromOffsets,
} from './geometry'
import type { Guide, MeshCell } from './types'

const g = (id: string, axis: 'x' | 'y', pos: number, offsetMm: number): Guide => ({
  id,
  axis,
  pos,
  offsetMm,
})

/**
 * Three columns and two rows with the spans printed on the Main Deck drawing:
 * across 2500, 9500, 14500; down 16000, 6200.
 */
const MAIN_DECK_GUIDES: Guide[] = [
  g('x0', 'x', 0.0, 0),
  g('x1', 'x', 0.1, 2500),
  g('x2', 'x', 0.5, 12000),
  g('x3', 'x', 1.0, 26500),
  g('y0', 'y', 0.0, 0),
  g('y1', 'y', 0.7, 16000),
  g('y2', 'y', 1.0, 22200),
]

/**
 * The Main Deck drawing's full across-chain, as the admin types it: the datum
 * row carries no span, then 2500, 9500, 14500, 14500, 9500, 7600.
 */
const ACROSS_SPANS = [0, 2500, 9500, 14500, 14500, 9500, 7600]
const ACROSS_OFFSETS = [0, 2500, 12000, 26500, 41000, 50500, 58100]

describe('offsetsFromSpans', () => {
  it('running-sums the real drawing across-chain from a zero datum', () => {
    expect(offsetsFromSpans(0, ACROSS_SPANS)).toEqual(ACROSS_OFFSETS)
  })

  it('produces a strictly increasing chain', () => {
    const offsets = offsetsFromSpans(0, ACROSS_SPANS)
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1])
  })

  it('shifts every offset downstream of an edited span, and none upstream', () => {
    // The third real span, 14500 -> 15000. This is the whole point of the
    // conversion: rows 0-2 must be untouched and rows 3-6 must each move by
    // exactly +500. A conversion that writes only the edited row's offset
    // fails on element 4; one that also moves the datum fails on element 1.
    const edited = [...ACROSS_SPANS]
    edited[3] = 15000
    expect(offsetsFromSpans(0, edited)).toEqual([0, 2500, 12000, 27000, 41500, 51000, 58600])
  })

  it('places the datum wherever the caller says, not at zero', () => {
    expect(offsetsFromSpans(1000, [0, 2500, 9500])).toEqual([1000, 3500, 13000])
  })
})

describe('spansFromOffsets', () => {
  it('differences the real drawing across-chain, datum first', () => {
    expect(spansFromOffsets(ACROSS_OFFSETS)).toEqual(ACROSS_SPANS)
  })

  it('round-trips through offsetsFromSpans unchanged', () => {
    expect(spansFromOffsets(offsetsFromSpans(0, ACROSS_SPANS))).toEqual(ACROSS_SPANS)
    expect(offsetsFromSpans(0, spansFromOffsets(ACROSS_OFFSETS))).toEqual(ACROSS_OFFSETS)
  })

  it('has nothing to say about an empty or single-guide axis', () => {
    expect(spansFromOffsets([])).toEqual([])
    expect(spansFromOffsets([58100])).toEqual([0])
  })
})

describe('deriveCellArea', () => {
  it('multiplies real-world spans and converts mm² to m²', () => {
    // 14500mm × 16000mm = 232 m²
    expect(deriveCellArea(g('a', 'x', 0, 12000), g('b', 'x', 0, 26500), g('c', 'y', 0, 0), g('d', 'y', 0, 16000))).toBeCloseTo(232, 9)
  })

  it('is orientation-independent', () => {
    const a = deriveCellArea(g('a', 'x', 0, 0), g('b', 'x', 0, 2500), g('c', 'y', 0, 0), g('d', 'y', 0, 16000))
    const b = deriveCellArea(g('b', 'x', 0, 2500), g('a', 'x', 0, 0), g('d', 'y', 0, 16000), g('c', 'y', 0, 0))
    expect(a).toBeCloseTo(b, 12)
  })
})

describe('buildMeshFromGuides', () => {
  it('produces one cell per interval pair', () => {
    // 4 x-guides → 3 columns; 3 y-guides → 2 rows
    expect(buildMeshFromGuides(MAIN_DECK_GUIDES)).toHaveLength(6)
  })

  it('names cells row-major with 1-based row and column', () => {
    const codes = buildMeshFromGuides(MAIN_DECK_GUIDES).map((c) => c.code)
    expect(codes).toEqual(['R1C1', 'R1C2', 'R1C3', 'R2C1', 'R2C2', 'R2C3'])
  })

  it('tiles the image with no gaps and no overlaps', () => {
    const cells = buildMeshFromGuides(MAIN_DECK_GUIDES)
    const covered = cells.reduce((sum, c) => sum + c.w * c.h, 0)
    expect(covered).toBeCloseTo(1, 12)
  })

  it('derives each area from real-world spans', () => {
    const cells = buildMeshFromGuides(MAIN_DECK_GUIDES)
    // R1C3 spans 14500mm × 16000mm
    expect(cells.find((c) => c.code === 'R1C3')!.areaM2).toBeCloseTo(232, 9)
    // R2C1 spans 2500mm × 6200mm
    expect(cells.find((c) => c.code === 'R2C1')!.areaM2).toBeCloseTo(15.5, 9)
  })

  it('sorts unordered guides before building', () => {
    const shuffled = [...MAIN_DECK_GUIDES].reverse()
    expect(buildMeshFromGuides(shuffled).map((c) => c.code)).toEqual(
      buildMeshFromGuides(MAIN_DECK_GUIDES).map((c) => c.code),
    )
  })

  it('returns nothing when an axis has fewer than two guides', () => {
    expect(buildMeshFromGuides([g('x0', 'x', 0, 0), g('y0', 'y', 0, 0)])).toEqual([])
  })
})

describe('mergeCells', () => {
  const cells = buildMeshFromGuides(MAIN_DECK_GUIDES)
  const byCode = (code: string) => cells.find((c) => c.code === code)!

  it('merges two horizontally adjacent cells into their bounding box', () => {
    const merged = mergeCells([byCode('R1C1'), byCode('R1C2')])
    expect(merged.x).toBeCloseTo(0, 12)
    expect(merged.w).toBeCloseTo(0.5, 12)
    expect(merged.y).toBeCloseTo(0, 12)
    expect(merged.h).toBeCloseTo(0.7, 12)
  })

  it('sums the real areas of the merged cells', () => {
    const merged = mergeCells([byCode('R1C1'), byCode('R1C2')])
    expect(merged.areaM2).toBeCloseTo(byCode('R1C1').areaM2 + byCode('R1C2').areaM2, 9)
  })

  it('keeps the top-left cell code', () => {
    expect(mergeCells([byCode('R1C2'), byCode('R1C1')]).code).toBe('R1C1')
  })

  it('merges a 2x2 block', () => {
    const merged = mergeCells([byCode('R1C1'), byCode('R1C2'), byCode('R2C1'), byCode('R2C2')])
    expect(merged.w).toBeCloseTo(0.5, 12)
    expect(merged.h).toBeCloseTo(1, 12)
  })

  it('rejects a selection that does not form a solid rectangle', () => {
    // L-shape: two cells in row 1 plus one in row 2 leaves a hole in the bbox
    expect(() => mergeCells([byCode('R1C1'), byCode('R1C2'), byCode('R2C1')])).toThrow(
      /solid rectangle/i,
    )
  })

  it('rejects a selection of fewer than two cells', () => {
    expect(() => mergeCells([byCode('R1C1')])).toThrow(/at least two/i)
  })

  it('rejects a selection containing the same cell twice', () => {
    expect(() => mergeCells([byCode('R1C1'), byCode('R1C1')])).toThrow(/more than once/i)
  })

  it('rejects overlapping cells even when their areas sum to the bounding box', () => {
    // The overlap masks a real gap: footprint is [0,0.9] plus [0.95,1.0], but
    // the summed area equals the bounding box exactly.
    const strip = (code: string, x: number, w: number): MeshCell => ({
      code, x, y: 0, w, h: 1, areaM2: w * 100,
    })
    const selection = [
      strip('A', 0, 0.4),
      strip('B', 0.35, 0.35),
      strip('C', 0.7, 0.2),
      strip('D', 0.95, 0.05),
    ]
    const covered = selection.reduce((s, c) => s + c.w * c.h, 0)
    expect(covered).toBeCloseTo(1, 12) // the area check alone would pass
    expect(() => mergeCells(selection)).toThrow(/overlapping/i)
  })

  it('accepts adjacent cells that share an edge exactly', () => {
    // Regression guard: an inclusive overlap test would reject every real merge.
    const merged = mergeCells([byCode('R1C1'), byCode('R1C2'), byCode('R2C1'), byCode('R2C2')])
    expect(merged.w).toBeCloseTo(0.5, 12)
    expect(merged.h).toBeCloseTo(1, 12)
  })
})

describe('areaDivergence', () => {
  const cell = (areaM2: number): { areaM2: number } => ({ areaM2 })

  it('returns the signed fractional gap between deck total and cell sum', () => {
    expect(areaDivergence(1000, [cell(950)])).toBeCloseTo(0.05, 12)
  })

  it('is negative when cells exceed the deck total', () => {
    expect(areaDivergence(1000, [cell(1100)])).toBeCloseTo(-0.1, 12)
  })

  it('returns 0 when the deck has no area', () => {
    expect(areaDivergence(0, [cell(10)])).toBe(0)
  })

  it('exposes the 5% threshold from the spec', () => {
    expect(AREA_DIVERGENCE_THRESHOLD).toBe(0.05)
  })
})

describe('divergesBeyondThreshold', () => {
  const cell = (areaM2: number) => ({ areaM2 })

  it('is false when cells match the deck total', () => {
    expect(divergesBeyondThreshold(1000, [cell(1000)])).toBe(false)
  })

  it('is false just inside the threshold', () => {
    expect(divergesBeyondThreshold(1000, [cell(960)])).toBe(false)
  })

  it('is true when cells under-cover beyond the threshold', () => {
    expect(divergesBeyondThreshold(1000, [cell(900)])).toBe(true)
  })

  it('is true when cells OVER-cover beyond the threshold', () => {
    // The reason this helper exists: areaDivergence is signed, so a caller
    // comparing `> THRESHOLD` would read -0.1 as within tolerance.
    expect(divergesBeyondThreshold(1000, [cell(1100)])).toBe(true)
    expect(areaDivergence(1000, [cell(1100)])).toBeLessThan(0)
  })

  it('is false for a deck with no area, matching areaDivergence', () => {
    expect(divergesBeyondThreshold(0, [cell(10)])).toBe(false)
  })

  it('does not warn at exactly the threshold', () => {
    // 950 of 1000 is exactly 5%. The comparison is strict `>`, so the threshold
    // itself is within tolerance -- "diverges beyond 5%", not "reaches 5%".
    // Pinned because a refactor to >= would pass every other test in this block.
    expect(divergesBeyondThreshold(1000, [cell(950)])).toBe(false)
  })

  it('warns just past the threshold', () => {
    expect(divergesBeyondThreshold(1000, [cell(949)])).toBe(true)
  })
})

describe('prorateCellAreas', () => {
  const mesh = (code: string, w: number, h: number) => ({
    code, x: 0, y: 0, w, h, areaM2: 0,
  })

  it('splits the deck total by normalized pixel area', () => {
    const out = prorateCellAreas(1000, [mesh('A', 0.5, 1), mesh('B', 0.5, 1)])
    expect(out.map((c) => c.areaM2)).toEqual([500, 500])
  })

  it('weights unequal cells proportionally', () => {
    const out = prorateCellAreas(900, [mesh('A', 0.3, 1), mesh('B', 0.6, 1)])
    expect(out[0].areaM2).toBeCloseTo(300, 9)
    expect(out[1].areaM2).toBeCloseTo(600, 9)
  })

  it('preserves the deck total exactly', () => {
    const out = prorateCellAreas(1234.5, [mesh('A', 0.1, 0.2), mesh('B', 0.3, 0.4), mesh('C', 0.5, 0.6)])
    expect(out.reduce((s, c) => s + c.areaM2, 0)).toBeCloseTo(1234.5, 6)
  })

  it('leaves geometry untouched', () => {
    // Non-zero x/y on purpose: with both at 0 the assertion cannot tell a
    // preserved coordinate from a coincidentally-zero one.
    const input = [{ code: 'A', x: 0.25, y: 0.4, w: 0.5, h: 1, areaM2: 0 }]
    const out = prorateCellAreas(1000, input)
    expect(out[0]).toMatchObject({ code: 'A', x: 0.25, y: 0.4, w: 0.5, h: 1 })
  })

  it('returns zero areas when the cells have no pixel area at all', () => {
    const out = prorateCellAreas(1000, [mesh('A', 0, 0)])
    expect(out[0].areaM2).toBe(0)
  })
})
