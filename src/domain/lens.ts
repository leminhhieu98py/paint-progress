import { NOT_STARTED_COLOR } from './pieSlices'
import { stageSeqOf } from './progress'
import type { Cell, Stage } from './types'

/**
 * Two ways of colouring the same `cells.stage_id` (spec §8.5).
 *
 * The admin's progress screen puts them side by side because they answer
 * different questions on the same data: "how far has the paint got" and "is the
 * scaffolding still up". A bay at Coat 2 is well along the first and untouched
 * on the second, and reading one for the other is how a crane gets booked for a
 * deck nobody can reach yet.
 *
 * Both are keyed by cell CODE, which is what DrawingCanvas keys every per-cell
 * map on, and both are pure so a report can build the same colours offscreen.
 */

/**
 * A bay whose scaffolding has NOT come down.
 *
 * Deliberately the same grey the pie gives "Chưa bắt đầu": on this lens the
 * question is binary, and reusing the palette's one neutral keeps a screen that
 * already carries five stage colours from growing a sixth meaning.
 */
export const SCAFFOLD_PENDING_COLOR = NOT_STARTED_COLOR

/** Stage colour per cell code. A cell with no stage, or one naming a stage this
 *  deck does not declare, is left OUT of the map rather than given a colour --
 *  DrawingCanvas renders an unlisted cell unfilled, so the drawing shows
 *  through, which is what a bay nobody has touched should look like. */
export function paintLensColors(cells: Cell[], stages: Stage[]): Record<string, string> {
  const colors: Record<string, string> = {}
  for (const cell of cells) {
    if (!cell.stageId) continue
    const stage = stages.find((s) => s.id === cell.stageId)
    if (stage) colors[cell.code] = stage.color
  }
  return colors
}

/**
 * Scaffolding removal as done or not done, per cell code.
 *
 * The last stage by seq IS scaffolding removal -- on this project's spec it is
 * literally named "Tháo giáo", and the schema has no separate flag for it. Read
 * by seq rather than by array position: `listStages` sorts, but a caller
 * assembling stages by hand need not, and the wrong element would put the
 * scaffolding answer on a coat.
 *
 * Every cell gets an entry, including the pending ones. Unlike the paint lens,
 * "no colour" is not a meaningful third state here -- the scaffold is up or it
 * is down -- and an unfilled bay would read as missing data.
 *
 * A deck with no stages reads as nothing removed. That is the safe direction:
 * the alternative reports a deck ready to strike when its stage list merely
 * failed to load.
 */
export function scaffoldLensColors(cells: Cell[], stages: Stage[]): Record<string, string> {
  const lastSeq = stages.reduce((max, s) => Math.max(max, s.seq), 0)
  const last = stages.find((s) => s.seq === lastSeq)
  const colors: Record<string, string> = {}
  for (const cell of cells) {
    const done = last !== undefined && stageSeqOf(stages, cell.stageId) >= lastSeq
    colors[cell.code] = done ? last.color : SCAFFOLD_PENDING_COLOR
  }
  return colors
}
