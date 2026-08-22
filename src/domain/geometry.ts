import type { Guide, MeshCell } from './types'

/** Spec §3.4: the deck editor warns when cell areas diverge from the deck total by more than this. */
export const AREA_DIVERGENCE_THRESHOLD = 0.05

/**
 * Tolerance for comparing normalized (0..1) areas, never real-world m². Summing
 * hundreds of such values accumulates error around 1e-13, three orders of
 * magnitude below this, so no legitimate merge is rejected for rounding.
 */
const EPSILON = 1e-9

/** Real-world area of the bay bounded by two x-guides and two y-guides, in m². */
export function deriveCellArea(x1: Guide, x2: Guide, y1: Guide, y2: Guide): number {
  const spanX = Math.abs(x2.offsetMm - x1.offsetMm)
  const spanY = Math.abs(y2.offsetMm - y1.offsetMm)
  return (spanX * spanY) / 1e6
}

/**
 * Generates the full mesh of bays at guide intersections.
 *
 * Rows and columns are numbered 1-based from the top-left of the image, so
 * codes read R1C1, R1C2, ... row-major. The admin renames cells afterwards if
 * the drawing's own grid labels are preferred.
 */
export function buildMeshFromGuides(guides: Guide[]): MeshCell[] {
  const xs = guides.filter((g) => g.axis === 'x').sort((a, b) => a.pos - b.pos)
  const ys = guides.filter((g) => g.axis === 'y').sort((a, b) => a.pos - b.pos)

  if (xs.length < 2 || ys.length < 2) return []

  const cells: MeshCell[] = []
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      cells.push({
        code: `R${r + 1}C${c + 1}`,
        x: xs[c].pos,
        y: ys[r].pos,
        w: xs[c + 1].pos - xs[c].pos,
        h: ys[r + 1].pos - ys[r].pos,
        areaM2: deriveCellArea(xs[c], xs[c + 1], ys[r], ys[r + 1]),
      })
    }
  }
  return cells
}

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
 * (0.9,0.95). Cells from one buildMeshFromGuides call never overlap, so the
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
