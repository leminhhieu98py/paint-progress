import { describe, expect, it } from 'vitest'
import {
  AREA_DIVERGENCE_THRESHOLD,
  areaDivergence,
  buildMeshFromGuides,
  CELL_RESHAPE_THRESHOLD,
  cellReshaped,
  deriveCellArea,
  divergesBeyondThreshold,
  hasUndeclaredArea,
  mergeCells,
  MIN_GUIDE_GAP,
  moveGuideClamped,
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

  it('ignores spansMm[0], the datum row\'s own span, no matter what value it carries', () => {
    // The doc comment says spansMm[0] is ignored -- every other test in this
    // file passes 0 there, which folding it into the running sum would also
    // satisfy, so this is the one case that actually exercises the contract.
    // A huge, obviously-wrong value proves it: if it were not ignored, the
    // first offset alone would come back as 1000 + 999999, not 1000.
    expect(offsetsFromSpans(1000, [999999, 2500, 9500])).toEqual([1000, 3500, 13000])
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

describe('moveGuideClamped', () => {
  /** The real across-chain, one guide per offset, evenly spread across the drawing. */
  const chain: Guide[] = ACROSS_OFFSETS.map((offsetMm, i) =>
    g(`x${i}`, 'x', i / (ACROSS_OFFSETS.length - 1), offsetMm),
  )

  /** The mm chain as the mesh reads it: offsets in POS order. */
  const posOrderedOffsets = (guides: Guide[]) =>
    guides
      .filter((guide) => guide.axis === 'x')
      .slice()
      .sort((a, b) => a.pos - b.pos)
      .map((guide) => guide.offsetMm)

  it('leaves the mm chain monotonic when a guide is dragged past its neighbour', () => {
    // The reviewer's case: the 4th vertical (26500 mm) dragged beyond the 5th
    // (41000 mm). Unclamped, the pos-ordered offsets become
    // [0, 2500, 12000, 41000, 26500, 50500, 58100] and the spans
    // [0, 2500, 9500, 29000, -14500, 24000, 7600] -- a -14500 mm bay that
    // deriveCellArea's Math.abs renders as a plausible 232 m², inflating the
    // chain from 58100 to 87100 mm.
    const dragged = moveGuideClamped(chain, 3, 0.9)

    const offsets = posOrderedOffsets(dragged)
    expect(offsets).toEqual(ACROSS_OFFSETS)
    expect(spansFromOffsets(offsets).every((span) => span >= 0)).toBe(true)
  })

  it('stops the guide just short of its upper neighbour, not on top of it', () => {
    // Landing exactly on the neighbour's pos leaves the two ordered by array
    // position rather than by offset, which is the same pos/offset
    // disagreement one step down.
    const dragged = moveGuideClamped(chain, 3, 0.9)
    expect(dragged[3].pos).toBe(chain[4].pos - MIN_GUIDE_GAP)
    expect(dragged[3].pos).toBeLessThan(chain[4].pos)
  })

  it('clamps a drag below the lower neighbour too', () => {
    const dragged = moveGuideClamped(chain, 3, 0)
    expect(dragged[3].pos).toBe(chain[2].pos + MIN_GUIDE_GAP)
    expect(posOrderedOffsets(dragged)).toEqual(ACROSS_OFFSETS)
  })

  it('allows a move that stays between the neighbours', () => {
    // The clamp must not be a no-op dressed as a guard: a legitimate nudge has
    // to actually move the guide.
    const between = (chain[2].pos + chain[4].pos) / 2
    expect(moveGuideClamped(chain, 3, between)[3].pos).toBe(between)
  })

  it('bounds the outermost guides by the drawing edges, not by a missing neighbour', () => {
    expect(moveGuideClamped(chain, 0, -0.5)[0].pos).toBe(0)
    expect(moveGuideClamped(chain, 6, 1.5)[6].pos).toBe(1)
  })

  it('ignores guides on the other axis', () => {
    // A y-guide sitting between two x-guides must not bound an x-drag: the two
    // axes have entirely independent chains, and treating them as one would
    // clamp a legitimate move for no reason.
    const mixed: Guide[] = [
      g('x0', 'x', 0, 0),
      g('y0', 'y', 0.5, 0),
      g('x1', 'x', 1, 20000),
      g('y1', 'y', 0.6, 10000),
    ]
    // Bounded by the x-guide at pos 1, so 0.9 goes through untouched. Were the
    // y-guides counted, the nearest "neighbour" would be the one at pos 0.5 and
    // this would come back clamped to just under it.
    expect(moveGuideClamped(mixed, 0, 0.9)[0].pos).toBe(0.9)
  })

  it('returns the guides untouched for an index that does not exist', () => {
    expect(moveGuideClamped(chain, 99, 0.5)).toBe(chain)
  })

  it('refuses the move when the neighbours leave no room', () => {
    // Neighbours one quantization step apart: there is no representable pos
    // strictly between them, so the only honest answer is to leave the guide
    // alone rather than pick a side.
    const cramped: Guide[] = [
      g('x0', 'x', 0.5, 0),
      g('x1', 'x', 0.5 + MIN_GUIDE_GAP / 2, 1000),
      g('x2', 'x', 0.5 + MIN_GUIDE_GAP, 2000),
    ]
    expect(moveGuideClamped(cramped, 1, 0.9)).toBe(cramped)
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
