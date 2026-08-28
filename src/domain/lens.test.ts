import { describe, expect, it } from 'vitest'
import {
  paintLensColors, scaffoldLensColors, zoneLensColors,
  SCAFFOLD_PENDING_COLOR, ZONE_PALETTE,
} from './lens'
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

  it('uses a pending colour no paint stage can be mistaken for', () => {
    // Measured, not asserted by eye: the first build gave pending the same grey
    // the pie gives "Chưa bắt đầu" (#d9d9d9), which sits next to Coat 2's
    // #bfbfbf. Side by side on a real deck the two lenses were indistinguishable
    // at a glance, which costs the second canvas its entire reason to exist.
    // Every colour this project's default template ships, plus the pie's two
    // neutrals, must stay clear of it.
    const palette = [
      '#fadb14', '#bfbfbf', '#52c41a', '#1677ff', '#722ed1', // DEFAULT_STAGE_TEMPLATE
      '#d9d9d9', '#8c8c8c',                                   // not-started, unmapped
    ]
    expect(palette).not.toContain(SCAFFOLD_PENDING_COLOR)

    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const pending = rgb(SCAFFOLD_PENDING_COLOR)
    for (const other of palette) {
      const d = rgb(other).reduce((sum, c, i) => sum + (c - pending[i]) ** 2, 0) ** 0.5
      expect(d).toBeGreaterThan(60)
    }
  })

  it('reads the last stage by seq, not by array position', () => {
    // listStages sorts, but a caller assembling stages by hand need not, and
    // "the last element" would then call the wrong stage scaffolding removal.
    const unsorted = [STAGES[2], STAGES[0], STAGES[1]]
    expect(scaffoldLensColors([cell('R1C1', 's3')], unsorted).R1C1).toBe('#722ed1')
  })
})

describe('zoneLensColors', () => {
  const cells = [
    { id: 'c1', code: 'R1C1' },
    { id: 'c2', code: 'R1C2' },
    { id: 'c3', code: 'R2C1' },
  ]
  const zone = (id: string, cellIds: string[]) => ({ id, cellIds })

  it('gives every bay of a zone that zone\'s colour', () => {
    expect(zoneLensColors([zone('a', ['c1', 'c2'])], cells)).toEqual({
      R1C1: ZONE_PALETTE[0], R1C2: ZONE_PALETTE[0],
    })
  })

  it('gives each zone a different colour', () => {
    const colors = zoneLensColors([zone('a', ['c1']), zone('b', ['c3'])], cells)
    expect(colors.R1C1).not.toBe(colors.R2C1)
  })

  it('colours by position, so a table row and its bays are the same zone', () => {
    // The zone table lists from the same array in the same order.
    const colors = zoneLensColors([zone('a', ['c1']), zone('b', ['c3'])], cells)
    expect(colors.R1C1).toBe(ZONE_PALETTE[0])
    expect(colors.R2C1).toBe(ZONE_PALETTE[1])
  })

  it('repeats the palette rather than running out', () => {
    // Eleven zones on one coat is not a plan anybody reads by colour alone, and
    // a generated eleventh colour would be worse than a repeated one.
    const many = Array.from({ length: 11 }, (_, i) => zone(`z${i}`, ['c1']))
    expect(() => zoneLensColors(many, cells)).not.toThrow()
    expect(zoneLensColors([many[10]], cells).R1C1).toBe(ZONE_PALETTE[0])
  })

  it('leaves a bay in no zone out of the map', () => {
    // "Not planned" is the common case on this lens; a fill would hide the
    // drawing under most of the deck.
    expect(zoneLensColors([zone('a', ['c1'])], cells).R2C1).toBeUndefined()
  })

  it('ignores a cell id that is not on this deck', () => {
    expect(zoneLensColors([zone('a', ['c1', 'nope'])], cells)).toEqual({
      R1C1: ZONE_PALETTE[0],
    })
  })

  it('gives every palette colour a distinct value', () => {
    // A duplicate would silently make two zones look like one.
    expect(new Set(ZONE_PALETTE).size).toBe(ZONE_PALETTE.length)
  })
})
