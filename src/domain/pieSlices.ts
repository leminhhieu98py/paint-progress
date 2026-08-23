import type { Stage } from './types'

export const NOT_STARTED_KEY = 'not-started'
export const UNMAPPED_KEY = 'unmapped'
export const NOT_STARTED_LABEL = 'Chưa bắt đầu'
/** The deck area that no cell covers: openings, the E-house, anything outside
 *  the drawn mesh. Spec §3.2 -- legitimately not zero. */
export const UNMAPPED_LABEL = 'Chưa chia ô'
export const NOT_STARTED_COLOR = '#d9d9d9'
export const UNMAPPED_COLOR = '#8c8c8c'

export interface PieSlice {
  /** Stage id, or NOT_STARTED_KEY / UNMAPPED_KEY. */
  key: string
  label: string
  areaM2: number
  color: string
}

/**
 * Area by CURRENT stage, plus the two slices that keep the pie on the deck's own
 * denominator.
 *
 * Current stage, not cumulative: a cell counts once, in the slice for the coat
 * it is actually sitting at. The cumulative A_i belongs to the spec table.
 *
 * The unmapped slice is the point of this function. Every percentage in this app
 * divides by deck.total_area_m2 (spec §3.2), but a pie chart derives each
 * slice's share from the sum of the data it is handed -- so unless that sum IS
 * total_area_m2, the pie silently renormalises over Σ cell.area_m2 and disagrees
 * with the headline percentage sitting in the middle of it. On the Cellar Deck
 * that gap is hundreds of square metres.
 *
 * It is omitted when it would be zero or negative. Negative is reachable: the
 * deck editor's divergence banner is non-blocking (spec §11), so cells may
 * over-cover a declared area. There is no negative slice to draw, and in that
 * one state the pie does renormalise -- disclosed here rather than papered over.
 *
 * A cell pointing at a stage that is not in `stages` counts as not started,
 * matching stageSeqOf and nextStage. Dropping it instead would take its area out
 * of the pie while leaving it in total_area_m2, and the slices would stop
 * summing to the deck.
 */
export function buildStageSlices(
  totalAreaM2: number,
  cells: { areaM2: number; stageId: string | null }[],
  stages: Stage[],
): PieSlice[] {
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)
  const known = new Set(ordered.map((s) => s.id))

  const slices: PieSlice[] = ordered.map((stage) => ({
    key: stage.id,
    label: stage.name,
    areaM2: cells.reduce((sum, c) => (c.stageId === stage.id ? sum + c.areaM2 : sum), 0),
    color: stage.color,
  }))

  slices.push({
    key: NOT_STARTED_KEY,
    label: NOT_STARTED_LABEL,
    areaM2: cells.reduce(
      (sum, c) => (c.stageId === null || !known.has(c.stageId) ? sum + c.areaM2 : sum),
      0,
    ),
    color: NOT_STARTED_COLOR,
  })

  const unmappedAreaM2 = totalAreaM2 - cells.reduce((sum, c) => sum + c.areaM2, 0)
  if (unmappedAreaM2 > 0) {
    slices.push({
      key: UNMAPPED_KEY,
      label: UNMAPPED_LABEL,
      areaM2: unmappedAreaM2,
      color: UNMAPPED_COLOR,
    })
  }

  return slices
}
