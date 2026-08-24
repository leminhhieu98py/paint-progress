import type { MeshCell } from './types'

/** Spec §3.4: the deck editor warns when cell areas diverge from the deck total by more than this. */
export const AREA_DIVERGENCE_THRESHOLD = 0.05

/**
 * Tolerance for comparing normalized (0..1) areas and coordinates, never
 * real-world m².
 *
 * Sized by the DATABASE, not by float accumulation. `cells.x/y/w/h` are
 * `numeric(8,6)` (0001_schema.sql:76-79), so every coordinate that has been
 * through Postgres is quantized to 1e-6 -- and x, y, w and h are each rounded
 * independently, so two cells that were exactly adjacent when the mesh was
 * generated come back with a gap or an overlap of up to 1e-6 between them. That
 * dominates float accumulation (around 1e-13 over hundreds of values) by five
 * orders of magnitude, and at 1e-9 it made `mergeCells` reject every pair of
 * adjacent cells on any deck that had been saved and reopened -- with advice
 * ("select more cells to fill the gap") that could not be followed.
 *
 * Do not tighten this back towards float scale without re-reading numeric(8,6)
 * above. 1e-5 still rejects a real gap by four orders of magnitude: a genuinely
 * missing cell is a whole bay (0.005 of the drawing or more), not a rounding
 * artefact.
 */
const EPSILON = 1e-5

/**
 * Collapses a selection into one cell spanning their bounding box.
 *
 * A selection is valid only if it tiles that bounding box completely. Three
 * things are checked, and all three are needed:
 *
 *   - no duplicate cells, by code;
 *   - no two cells overlap;
 *   - the summed area equals the bounding-box area.
 *
 * The area comparison alone is NOT sufficient. Overlap can mask a gap and
 * still balance the books: cells covering [0,0.4], [0.35,0.7], [0.7,0.9] and
 * [0.95,1.0] sum to exactly their bounding box while leaving a real hole at
 * (0.9,0.95). Cells from one detection pass never overlap, so the
 * area check would be enough for them — but MeshCell deliberately carries no
 * mesh provenance, so nothing here can verify that the caller respected it.
 * Checking overlap directly makes the guarantee hold for any input.
 */
export function mergeCells(selected: MeshCell[]): MeshCell {
  if (selected.length < 2) {
    throw new Error('Merge needs at least two cells')
  }

  const codes = new Set(selected.map((c) => c.code))
  if (codes.size !== selected.length) {
    throw new Error('Merge selection contains the same cell more than once')
  }

  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      if (overlaps(selected[i], selected[j])) {
        throw new Error(
          `Merge selection has overlapping cells: ${selected[i].code} and ${selected[j].code}`,
        )
      }
    }
  }

  const minX = Math.min(...selected.map((c) => c.x))
  const minY = Math.min(...selected.map((c) => c.y))
  const maxX = Math.max(...selected.map((c) => c.x + c.w))
  const maxY = Math.max(...selected.map((c) => c.y + c.h))

  const bboxArea = (maxX - minX) * (maxY - minY)
  const covered = selected.reduce((sum, c) => sum + c.w * c.h, 0)

  if (Math.abs(bboxArea - covered) > EPSILON) {
    throw new Error('Selection must form a solid rectangle')
  }

  const topLeft = [...selected].sort((a, b) => a.y - b.y || a.x - b.x)[0]

  return {
    code: topLeft.code,
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    areaM2: selected.reduce((sum, c) => sum + c.areaM2, 0),
  }
}

/**
 * Do two axis-aligned cells share interior area? Cells that merely touch along
 * an edge do not overlap — that is the normal case for adjacent mesh cells, so
 * the comparison is strict.
 */
function overlaps(a: MeshCell, b: MeshCell): boolean {
  return (
    a.x < b.x + b.w - EPSILON &&
    b.x < a.x + a.w - EPSILON &&
    a.y < b.y + b.h - EPSILON &&
    b.y < a.y + a.h - EPSILON
  )
}

/**
 * Signed fractional gap between the deck's authoritative area and the sum of
 * its cells. Positive means cells under-cover the deck, which is normal —
 * openings and the E-house are not cells. Compare against
 * AREA_DIVERGENCE_THRESHOLD to decide whether to warn.
 */
export function areaDivergence(
  totalAreaM2: number,
  cells: { areaM2: number }[],
): number {
  if (totalAreaM2 <= 0) return 0
  const sum = cells.reduce((acc, c) => acc + c.areaM2, 0)
  return (totalAreaM2 - sum) / totalAreaM2
}

/**
 * Whether the cells diverge from the deck's authoritative area by more than the
 * threshold, in EITHER direction.
 *
 * Prefer this to comparing areaDivergence directly: that value is signed, so
 * `divergence > AREA_DIVERGENCE_THRESHOLD` silently treats over-coverage as
 * within tolerance. Spec §3.4 warns on divergence in either direction.
 */
export function divergesBeyondThreshold(
  totalAreaM2: number,
  cells: { areaM2: number }[],
): boolean {
  return Math.abs(areaDivergence(totalAreaM2, cells)) > AREA_DIVERGENCE_THRESHOLD
}

/**
 * A deck with cells but no declared area. Distinct from "no divergence":
 * areaDivergence returns 0 here to avoid dividing by zero, which silently
 * disables the divergence banner in the one case where the deck's reported
 * progress is guaranteed wrong -- every ratio divides by total_area_m2, so a
 * zero total reports 0% no matter how much paint is on the deck.
 *
 * `decks.total_area_m2` is `not null default 0` and `createDeck` never sets it,
 * so this is the state every deck starts in, not an exotic one.
 *
 * Only `cells.length` is read; the element type matches areaDivergence and
 * divergesBeyondThreshold on purpose, so the three can be called on the same
 * value at the same call site without a cast.
 */
export function hasUndeclaredArea(
  totalAreaM2: number,
  cells: { areaM2: number }[],
): boolean {
  return totalAreaM2 <= 0 && cells.length > 0
}

/**
 * How far one cell's area may move, as a fraction of its old area, before the
 * move has to be disclosed to whoever is about to save it.
 *
 * Deliberately NOT AREA_DIVERGENCE_THRESHOLD, despite sharing its value today.
 * That one is a deck-level tolerance for cells under-covering a declared area,
 * which is normal and expected (openings and the E-house are not cells); this
 * one is a per-cell decision about whether a recorded stage has been carried
 * onto ground nobody inspected. Retuning the deck tolerance must not silently
 * change which reshapes get disclosed.
 */
export const CELL_RESHAPE_THRESHOLD = 0.05

/**
 * Whether a cell keeping its code -- and therefore its recorded stage -- has
 * moved onto a materially different extent.
 *
 * The old area is the denominator: the question is how far this cell moved from
 * what was signed off on, not how far the new extent is from the old one.
 *
 * An old area of zero is always disclosed rather than divided by. That case is
 * the worst one available, not an edge case to shrug at: a deck meshed before
 * its area was declared holds cells at 0 m², a GS can tick them anyway, and
 * re-meshing after the area is declared moves every one of them from 0 to
 * hundreds of m² with its stage intact. Any relative test returns "no change"
 * there, so the disclosure would be skipped in exactly its worst case.
 */
export function cellReshaped(fromAreaM2: number, toAreaM2: number): boolean {
  if (fromAreaM2 <= 0) return toAreaM2 > 0
  return Math.abs((fromAreaM2 - toAreaM2) / fromAreaM2) > CELL_RESHAPE_THRESHOLD
}

/**
 * Fallback for a drawing whose dimensions are unusable: split the deck's
 * authoritative area across cells by their normalized pixel area.
 *
 * The deck records `area_source: 'prorated'` when this is used, so a report can
 * disclose that its per-cell figures are estimates rather than measured spans.
 */
export function prorateCellAreas(totalAreaM2: number, cells: MeshCell[]): MeshCell[] {
  const totalPixelArea = cells.reduce((sum, c) => sum + c.w * c.h, 0)
  if (totalPixelArea <= 0) return cells.map((c) => ({ ...c, areaM2: 0 }))
  return cells.map((c) => ({
    ...c,
    areaM2: (totalAreaM2 * (c.w * c.h)) / totalPixelArea,
  }))
}
