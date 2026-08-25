import { describe, expect, it } from 'vitest'
import {
  AREA_DIVERGENCE_THRESHOLD,
  drawnCell,
  areaDivergence,
  CELL_RESHAPE_THRESHOLD,
  cellReshaped,
  divergesBeyondThreshold,
  hasUndeclaredArea,
  mergeCells,
  prorateCellAreas,
} from './geometry'
import type { MeshCell } from './types'

/**
 * Three columns and two rows, the shape the Main Deck drawing's own chain used
 * to produce: across 2500, 9500, 14500 mm; down 16000, 6200 mm. Written out as
 * cells rather than derived from guides -- guides are gone, and what mergeCells
 * needs is a set of adjacent cells with known areas, which is what this is.
 */
const MAIN_DECK_CELLS: MeshCell[] = [
  { code: 'R1C1', x: 0, y: 0, w: 0.1, h: 0.7, areaM2: 40 },
  { code: 'R1C2', x: 0.1, y: 0, w: 0.4, h: 0.7, areaM2: 152 },
  { code: 'R1C3', x: 0.5, y: 0, w: 0.5, h: 0.7, areaM2: 232 },
  { code: 'R2C1', x: 0, y: 0.7, w: 0.1, h: 0.3, areaM2: 15.5 },
  { code: 'R2C2', x: 0.1, y: 0.7, w: 0.4, h: 0.3, areaM2: 58.9 },
  { code: 'R2C3', x: 0.5, y: 0.7, w: 0.5, h: 0.3, areaM2: 89.9 },
]

describe('mergeCells', () => {
  const cells = MAIN_DECK_CELLS
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

  it('accepts adjacent cells that share an edge exactly, merging a 2x2 block', () => {
    // Regression guard: an inclusive overlap test would reject every real merge.
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

  it('merges two adjacent cells that have round-tripped through numeric(8,6)', () => {
    // The defect: cells.x/y/w/h are numeric(8,6), and x, y, w and h are each
    // rounded INDEPENDENTLY, so a pair that tiled exactly when the mesh was
    // generated comes back from Postgres with up to 1e-6 of gap between them.
    // At EPSILON = 1e-9 that made merging impossible on every saved deck, with
    // the only escape being a mesh regeneration that discards recorded
    // progress.
    //
    // Quantized here rather than written as exact fractions on purpose: exact
    // fractions leave no residual at all, so the test would pass at any epsilon
    // and prove nothing. The guide chain deliberately does NOT start at 0 --
    // when the first cell's x is 0 its width IS the shared guide's rounded pos,
    // the residual cancels, and the case disappears.
    const q6 = (v: number) => Math.round(v * 1e6) / 1e6
    const chain = [0.1234564, 0.3333335, 0.9999999]
    const h = 0.5
    const left: MeshCell = {
      code: 'R1C1', x: q6(chain[0]), y: 0, w: q6(chain[1] - chain[0]), h, areaM2: 100,
    }
    const right: MeshCell = {
      code: 'R1C2', x: q6(chain[1]), y: 0, w: q6(chain[2] - chain[1]), h, areaM2: 120,
    }

    // Self-arming: assert the residual this test exists for is actually
    // present, and is of database-quantization scale rather than float scale.
    // Without this the fixture could silently become exact and the test would
    // keep passing while covering nothing.
    const covered = left.w * left.h + right.w * right.h
    const bbox = (right.x + right.w - left.x) * h
    expect(Math.abs(bbox - covered)).toBeGreaterThan(1e-9)
    expect(Math.abs(bbox - covered)).toBeLessThan(1e-5)

    const merged = mergeCells([left, right])
    expect(merged.code).toBe('R1C1')
    expect(merged.areaM2).toBeCloseTo(220, 9)
  })

  it('still rejects a genuinely missing bay among quantized cells', () => {
    // The other half of the epsilon change: 1e-5 must not have swallowed a real
    // hole. These are the same quantized coordinates as above with the middle
    // bay left out, so the gap is a whole bay (0.2 of the drawing) rather than a
    // rounding artefact -- four orders of magnitude above the tolerance.
    const q6 = (v: number) => Math.round(v * 1e6) / 1e6
    const chain = [0.1234564, 0.3333335, 0.5432109, 0.9999999]
    const h = 0.5
    const strip = (code: string, from: number, to: number): MeshCell => ({
      code, x: q6(chain[from]), y: 0, w: q6(chain[to] - chain[from]), h, areaM2: 100,
    })

    expect(() => mergeCells([strip('R1C1', 0, 1), strip('R1C3', 2, 3)])).toThrow(
      /solid rectangle/i,
    )
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

describe('hasUndeclaredArea', () => {
  const cell = (areaM2: number) => ({ areaM2 })

  it('is true for a deck that has cells but no declared area', () => {
    // The state every deck starts in: total_area_m2 is `not null default 0` and
    // createDeck never sets it. areaDivergence returns 0 here to avoid dividing
    // by zero, so the divergence banner cannot fire -- while every ratio in
    // computeDeckProgress divides by the same zero and reports 0% forever.
    expect(hasUndeclaredArea(0, [cell(5008.22)])).toBe(true)
  })

  it('is false once an area is declared, however far it diverges', () => {
    // It must not double as a divergence check: this is specifically about the
    // denominator being missing, not about the numbers disagreeing.
    expect(hasUndeclaredArea(5258.5, [cell(100)])).toBe(false)
  })

  it('is false for a deck with no cells yet', () => {
    // Nothing has been authored, so there is no wrong number to report yet and
    // no reason to put an error in front of the admin.
    expect(hasUndeclaredArea(0, [])).toBe(false)
  })

  it('is true for a negative total, not just an exactly-zero one', () => {
    // Matches areaDivergence's own `<= 0` guard: a negative total divides just
    // as badly, and the check has to cover the same range or the two disagree
    // about which decks are safe.
    expect(hasUndeclaredArea(-1, [cell(10)])).toBe(true)
  })
})

describe('cellReshaped', () => {
  it('exposes its own threshold, separate from the deck-level one', () => {
    expect(CELL_RESHAPE_THRESHOLD).toBe(0.05)
  })

  it('is false for a move within the threshold', () => {
    // 232 -> 240 is 3.45% of the old area.
    expect(cellReshaped(232, 240)).toBe(false)
  })

  it('is true for a move past the threshold, in both directions', () => {
    expect(cellReshaped(232, 400)).toBe(true)
    expect(cellReshaped(400, 232)).toBe(true)
  })

  it('measures against the OLD area, not the new one', () => {
    // 200 -> 210.4 is 5.20% of 200 and 4.94% of 210.4: the two denominators
    // straddle the threshold, so this is the one ratio where swapping them
    // changes the answer.
    expect(cellReshaped(200, 210.4)).toBe(true)
    expect(cellReshaped(210.4, 200)).toBe(false)
  })

  it('does not fire exactly at the threshold', () => {
    // 100 -> 105 is exactly 5%. The comparison is strict `>`, matching
    // divergesBeyondThreshold.
    expect(cellReshaped(100, 105)).toBe(false)
    expect(cellReshaped(100, 105.1)).toBe(true)
  })

  it('always discloses a cell growing out of a zero area', () => {
    // The worst case, and the one a relative test silently skips: a deck meshed
    // before its area was declared holds 0 m² cells that a GS can still tick,
    // and re-meshing after the area is declared moves them to hundreds of m²
    // with their stage intact.
    expect(cellReshaped(0, 232)).toBe(true)
  })

  it('does not claim a reshape when a zero-area cell stays at zero', () => {
    expect(cellReshaped(0, 0)).toBe(false)
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

describe('drawnCell', () => {
  /** Two bays side by side with a gap between them, as a detected deck leaves one. */
  const NEIGHBOURS: MeshCell[] = [
    { code: 'R1C1', x: 0.1, y: 0.1, w: 0.2, h: 0.2, areaM2: 100 },
    { code: 'R1C2', x: 0.5, y: 0.1, w: 0.2, h: 0.2, areaM2: 100 },
  ]

  it('snaps a rough drag onto the edges of the bays around it', () => {
    // The admin drags by hand on a tablet, over a drawing scaled to fit. Landing
    // within a pixel of a beam is not something to ask of them, and a bay that
    // misses its neighbour by a hair leaves a sliver of deck belonging to
    // nobody -- or overlaps it and has that ground counted twice.
    const drawn = drawnCell(NEIGHBOURS, { x: 0.305, y: 0.104, w: 0.19, h: 0.198 })

    expect(drawn.x).toBeCloseTo(0.3, 9)
    expect(drawn.y).toBeCloseTo(0.1, 9)
    expect(drawn.x + drawn.w).toBeCloseTo(0.5, 9)
    expect(drawn.y + drawn.h).toBeCloseTo(0.3, 9)
  })

  it('leaves an edge alone when there is nothing near it to snap to', () => {
    // A bay hanging off the deck has one edge on open paper. Snapping it to the
    // nearest thing regardless of distance would drag it back onto the deck.
    const drawn = drawnCell(NEIGHBOURS, { x: 0.7, y: 0.1, w: 0.15, h: 0.2 })

    expect(drawn.x).toBeCloseTo(0.7, 9)
    expect(drawn.x + drawn.w).toBeCloseTo(0.85, 9)
  })

  it('numbers hand-drawn bays apart from the grid, so no code is claimed twice', () => {
    // Codes ARE the identity: zone membership and recorded progress are matched
    // on them. A hand-drawn bay that took R1C2 would silently inherit whatever
    // that bay had been ticked to.
    const first = drawnCell(NEIGHBOURS, { x: 0.3, y: 0.1, w: 0.2, h: 0.2 })
    expect(first.code).toBe('X1')

    const second = drawnCell([...NEIGHBOURS, first], { x: 0.1, y: 0.5, w: 0.2, h: 0.2 })
    expect(second.code).toBe('X2')
  })

  it('refuses a bay drawn over one that is already there', () => {
    // Two bays over the same ground are two the GS can tick and two the report
    // counts. The deck would read over 100% complete with paint left to do.
    expect(() => drawnCell(NEIGHBOURS, { x: 0.15, y: 0.15, w: 0.2, h: 0.2 }))
      .toThrow(/overlaps/)
  })

  it('refuses a drag too small to have been meant', () => {
    // A tap that moved a few pixels is a tap, not a bay.
    expect(() => drawnCell(NEIGHBOURS, { x: 0.4, y: 0.4, w: 0.002, h: 0.2 }))
      .toThrow(/too small/)
  })

  it('allows a bay that only meets its neighbour along an edge', () => {
    // Bays tile: they share their boundary exactly. An overlap test that counted
    // a shared edge would refuse every bay drawn where one belongs.
    expect(() => drawnCell(NEIGHBOURS, { x: 0.3, y: 0.1, w: 0.2, h: 0.2 })).not.toThrow()
  })
})
