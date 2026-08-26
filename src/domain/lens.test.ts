import { describe, expect, it } from 'vitest'
import { paintLensColors, scaffoldLensColors, SCAFFOLD_PENDING_COLOR } from './lens'
import type { Cell, Stage } from './types'

const STAGES: Stage[] = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]

const cell = (code: string, stageId: string | null): Cell => ({
  id: `id-${code}`, code, x: 0, y: 0, w: 0.1, h: 0.1, areaM2: 10, stageId,
})

describe('paintLensColors', () => {
  it('gives each cell the colour of the stage it has reached', () => {
    expect(paintLensColors([cell('R1C1', 's2'), cell('R1C2', 's1')], STAGES)).toEqual({
      R1C1: '#bfbfbf',
      R1C2: '#fadb14',
    })
  })

  it('leaves a cell that has not started out of the map', () => {
    // Absent, not "coloured grey": DrawingCanvas renders an unlisted cell
    // unfilled, so the drawing shows through. A grey fill would hide the plan
    // under every bay nobody has touched -- which is most of a new deck.
    expect(paintLensColors([cell('R1C1', null)], STAGES)).toEqual({})
  })

  it('leaves out a cell whose stage belongs to another deck', () => {
    // Reachable while a deck switch is in flight: the previous deck's cells are
    // still in state when the new deck's stages arrive. Colouring by a stage
    // that is not in this list would throw or paint an undefined colour.
    expect(paintLensColors([cell('R1C1', 'foreign')], STAGES)).toEqual({})
  })
})

describe('scaffoldLensColors', () => {
  it('colours a cell that has reached the last stage with that stage colour', () => {
    expect(scaffoldLensColors([cell('R1C1', 's3')], STAGES).R1C1).toBe('#722ed1')
  })

  it('colours every cell short of the last stage as still scaffolded', () => {
    // Including one at the second-to-last stage. Scaffolding is up or it is
    // down; a bay at Coat 2 is painted but the scaffold is still there, and the
    // whole point of this lens is that it answers a different question from the
    // paint one.
    const colors = scaffoldLensColors([cell('R1C1', 's2'), cell('R1C2', null)], STAGES)
    expect(colors.R1C1).toBe(SCAFFOLD_PENDING_COLOR)
    expect(colors.R1C2).toBe(SCAFFOLD_PENDING_COLOR)
  })

  it('marks every cell pending when the deck declares no stages', () => {
    // A deck whose stage list failed to load reads as "nothing removed", never
    // as "everything removed" -- the safe direction for a number somebody
    // schedules a crane against.
    expect(scaffoldLensColors([cell('R1C1', 's3')], [])).toEqual({
      R1C1: SCAFFOLD_PENDING_COLOR,
    })
  })

  it('reads the last stage by seq, not by array position', () => {
    // listStages sorts, but a caller assembling stages by hand need not, and
    // "the last element" would then call the wrong stage scaffolding removal.
    const unsorted = [STAGES[2], STAGES[0], STAGES[1]]
    expect(scaffoldLensColors([cell('R1C1', 's3')], unsorted).R1C1).toBe('#722ed1')
  })
})
