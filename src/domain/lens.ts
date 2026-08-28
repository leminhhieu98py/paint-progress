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
 * This started as the pie's "Chưa bắt đầu" grey, on the reasoning that a screen
 * carrying five stage colours should not grow a sixth meaning. Driving the real
 * deck killed that: #d9d9d9 sits beside Coat 2's #bfbfbf, so with a third of the
 * bays at Coat 2 the two canvases were the same picture at arm's length -- which
 * costs the second lens its entire reason for existing.
 *
 * A soft red instead, chosen for two reasons. It is far from every colour the
 * default template ships (the test measures it, so a future palette change that
 * collides fails rather than quietly degrades). And it puts the emphasis on the
 * bays that are still BLOCKED, which is the question this lens is asked: not
 * "what is finished" but "where can the crew not get to yet".
 *
 * Filled at 0.45 over the drawing, so the beams and grid labels stay readable.
 */
export const SCAFFOLD_PENDING_COLOR = '#ffa39e'

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

/**
 * Colours for the zone lens, in the order they are handed out.
 *
 * Chosen to stay apart from each other at the 0.45 fill opacity the canvas
 * draws at -- these sit next to one another on a plan and the whole job of the
 * lens is telling one group from its neighbour. They deliberately do NOT avoid
 * the stage palette: this lens replaces the stage colouring rather than sitting
 * beside it, so there is nothing to be confused with.
 */
export const ZONE_PALETTE = [
  '#eb2f96', // magenta
  '#13c2c2', // cyan
  '#fa8c16', // orange
  '#2f54eb', // geekblue
  '#a0d911', // lime
  '#f5222d', // red
  '#722ed1', // purple
  '#faad14', // gold
  '#08979c', // teal
  '#c41d7f', // deep magenta
]

/**
 * One colour per zone, per cell code -- the lens the admin gets after filtering
 * to a single coat.
 *
 * The question it answers is "which planned group is this bay in, and how does
 * it sit against its neighbours". The coat is already fixed by the filter, so
 * the stage's own colour would be one constant fill saying nothing.
 *
 * Zones are coloured by their position in the list, which is `listDeckZones`'
 * seq order -- the same order the zone table lists them in, so a row's swatch
 * and its bays on the drawing are always the same zone. The palette repeats
 * after ten; two zones that far apart in one coat's plan are not going to be
 * confused for each other, and a generated colour would be worse than a
 * repeated one.
 *
 * A bay in no zone is left OUT of the map, so the drawing shows through: on this
 * lens "not planned" is the common case and filling it would hide the plan.
 */
export function zoneLensColors(
  zones: { id: string; cellIds: string[] }[],
  cells: { id: string; code: string }[],
): Record<string, string> {
  const codeById = new Map(cells.map((c) => [c.id, c.code]))
  const colors: Record<string, string> = {}
  zones.forEach((zone, i) => {
    const color = ZONE_PALETTE[i % ZONE_PALETTE.length]
    for (const cellId of zone.cellIds) {
      const code = codeById.get(cellId)
      if (code) colors[code] = color
    }
  })
  return colors
}
