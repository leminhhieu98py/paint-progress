import type { Guide, MeshCell } from './types'

/** Spec §3.4: the deck editor warns when cell areas diverge from the deck total by more than this. */
export const AREA_DIVERGENCE_THRESHOLD = 0.05

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
 * A selection is valid only if it tiles that bounding box completely. Because
 * every mesh cell is axis-aligned and non-overlapping, comparing the summed
 * normalized area against the bounding box area is a sufficient check — an
 * L-shape leaves a hole and fails it.
 */
export function mergeCells(selected: MeshCell[]): MeshCell {
  if (selected.length < 2) {
    throw new Error('Merge needs at least two cells')
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
