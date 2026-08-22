import { describe, expect, it } from 'vitest'
import {
  AREA_DIVERGENCE_THRESHOLD,
  areaDivergence,
  buildMeshFromGuides,
  deriveCellArea,
  mergeCells,
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
