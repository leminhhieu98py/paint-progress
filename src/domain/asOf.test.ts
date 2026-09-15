import { describe, expect, it } from 'vitest'
import { cellStagesAsOf, HISTORY_FROM_LABEL } from './asOf'
import { EMPTY_EFFORT, type Cell, type DeckEvent, type Stage } from './types'

const STAGES: Stage[] = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]

const CELLS: Cell[] = [
  { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 500, stageId: 's3' },
  { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 500, stageId: 's2' },
]

const WORK = 'Công việc chính'

/** A `cell_events` row with only the fields the reconstruction reads filled in. */
let nextId = 0
const ev = (over: Partial<DeckEvent>): DeckEvent => ({
  id: (nextId += 1),
  deckName: 'Cellar Deck',
  cellCode: 'R1C1',
  cellAreaM2: 500,
  workName: WORK,
  toStageName: 'Coat 2',
  at: '2026-09-01T03:00:00Z',
  byId: null,
  note: '',
  reportNote: null,
  reportHidden: false,
  effort: EMPTY_EFFORT,
  effortEditedAt: null,
  effortEditedByName: null,
  ...over,
})

const stageOf = (cells: Cell[], code: string) => cells.find((c) => c.code === code)?.stageId

describe('cellStagesAsOf', () => {
  it('reads every bay as not started when nothing was ever recorded', () => {
    const asOf = cellStagesAsOf(CELLS, [], '2026-09-10', WORK, STAGES)
    expect(asOf.map((c) => c.stageId)).toEqual([null, null])
  })

  it('keeps the geometry and only replaces the coat', () => {
    const asOf = cellStagesAsOf(CELLS, [], '2026-09-10', WORK, STAGES)
    expect(asOf[0]).toEqual({ ...CELLS[0], stageId: null })
    // The input is the live deck the panel is still drawing from.
    expect(CELLS[0].stageId).toBe('s3')
  })

  it('takes the coat an earlier event moved the bay to', () => {
    const asOf = cellStagesAsOf(
      CELLS, [ev({ cellCode: 'R1C1', toStageName: 'Coat 2', at: '2026-09-02T03:00:00Z' })],
      '2026-09-10', WORK, STAGES,
    )
    expect(stageOf(asOf, 'R1C1')).toBe('s2')
    expect(stageOf(asOf, 'R1C2')).toBeNull()
  })

  it('ignores an event that happened after the day asked for', () => {
    const asOf = cellStagesAsOf(
      CELLS, [ev({ cellCode: 'R1C1', toStageName: 'Coat 2', at: '2026-09-11T03:00:00Z' })],
      '2026-09-10', WORK, STAGES,
    )
    expect(stageOf(asOf, 'R1C1')).toBeNull()
  })

  it('counts an event recorded on the day itself, to the end of it', () => {
    // 16:59 UTC is 23:59 in Vietnam, the same day. One minute later is the next.
    const late = ev({ cellCode: 'R1C1', toStageName: 'Coat 2', at: '2026-09-10T16:59:00Z' })
    expect(stageOf(cellStagesAsOf(CELLS, [late], '2026-09-10', WORK, STAGES), 'R1C1')).toBe('s2')
    const over = ev({ cellCode: 'R1C1', toStageName: 'Coat 2', at: '2026-09-10T17:00:00Z' })
    expect(stageOf(cellStagesAsOf(CELLS, [over], '2026-09-10', WORK, STAGES), 'R1C1')).toBeNull()
  })

  it('takes the later of two events on one day', () => {
    const events = [
      ev({ cellCode: 'R1C1', toStageName: 'Coat 2', at: '2026-09-03T01:00:00Z' }),
      ev({ cellCode: 'R1C1', toStageName: 'Tháo giáo', at: '2026-09-03T09:00:00Z' }),
    ]
    expect(stageOf(cellStagesAsOf(CELLS, events, '2026-09-10', WORK, STAGES), 'R1C1')).toBe('s3')
  })

  it('breaks a tie on the event id, the order the history itself is paged in', () => {
    const events = [
      ev({ id: 41, cellCode: 'R1C1', toStageName: 'Tháo giáo', at: '2026-09-03T01:00:00Z' }),
      ev({ id: 42, cellCode: 'R1C1', toStageName: 'Coat 2', at: '2026-09-03T01:00:00Z' }),
    ]
    expect(stageOf(cellStagesAsOf(CELLS, events, '2026-09-10', WORK, STAGES), 'R1C1')).toBe('s2')
  })

  it('reads a bay sent back to nothing as not started', () => {
    const events = [
      ev({ cellCode: 'R1C1', toStageName: 'Tháo giáo', at: '2026-09-02T03:00:00Z' }),
      ev({ cellCode: 'R1C1', toStageName: null, at: '2026-09-04T03:00:00Z' }),
    ]
    expect(stageOf(cellStagesAsOf(CELLS, events, '2026-09-10', WORK, STAGES), 'R1C1')).toBeNull()
    // ...and the coat it had before the removal, on a day before it.
    expect(stageOf(cellStagesAsOf(CELLS, events, '2026-09-03', WORK, STAGES), 'R1C1')).toBe('s3')
  })

  it('leaves another work\'s history out of this work\'s picture', () => {
    const events = [
      ev({ cellCode: 'R1C1', toStageName: 'Tháo giáo', at: '2026-09-02T03:00:00Z' }),
      ev({ cellCode: 'R1C1', toStageName: 'Coat 2', at: '2026-09-04T03:00:00Z', workName: 'Công việc khác' }),
    ]
    expect(stageOf(cellStagesAsOf(CELLS, events, '2026-09-10', WORK, STAGES), 'R1C1')).toBe('s3')
  })

  it('skips the rows written before the work model, which carry no work at all', () => {
    // 0024 is the migration; Linh ruled the history before it negligible.
    const events = [ev({ cellCode: 'R1C1', toStageName: 'Coat 2', workName: null })]
    expect(stageOf(cellStagesAsOf(CELLS, events, '2026-09-10', WORK, STAGES), 'R1C1')).toBeNull()
  })

  it('skips an event naming a coat this work no longer has', () => {
    const events = [
      ev({ cellCode: 'R1C1', toStageName: 'Tháo giáo', at: '2026-09-02T03:00:00Z' }),
      ev({ cellCode: 'R1C1', toStageName: 'Lớp đã đổi tên', at: '2026-09-04T03:00:00Z' }),
    ]
    expect(stageOf(cellStagesAsOf(CELLS, events, '2026-09-10', WORK, STAGES), 'R1C1')).toBe('s3')
  })

  it('ignores an event on a bay the deck no longer has', () => {
    const events = [ev({ cellCode: 'R9C9', toStageName: 'Coat 2' })]
    const asOf = cellStagesAsOf(CELLS, events, '2026-09-10', WORK, STAGES)
    expect(asOf.map((c) => c.code)).toEqual(['R1C1', 'R1C2'])
  })

  it('does not depend on the order the events arrive in', () => {
    const events = [
      ev({ id: 1, cellCode: 'R1C1', toStageName: 'Blast + Coat 1', at: '2026-09-01T03:00:00Z' }),
      ev({ id: 2, cellCode: 'R1C1', toStageName: 'Coat 2', at: '2026-09-03T03:00:00Z' }),
      ev({ id: 3, cellCode: 'R1C1', toStageName: 'Tháo giáo', at: '2026-09-12T03:00:00Z' }),
      ev({ id: 4, cellCode: 'R1C2', toStageName: 'Blast + Coat 1', at: '2026-09-02T03:00:00Z' }),
      ev({ id: 5, cellCode: 'R1C2', toStageName: null, at: '2026-09-05T03:00:00Z' }),
    ]
    const expected = { R1C1: 's2', R1C2: null }
    // Every rotation of the list, so no arrangement of a paged read can change
    // the answer -- the pager orders by `at` then `id`, and this must not care.
    for (let i = 0; i < events.length; i += 1) {
      const rotated = [...events.slice(i), ...events.slice(0, i)]
      const asOf = cellStagesAsOf(CELLS, rotated, '2026-09-10', WORK, STAGES)
      expect({ R1C1: stageOf(asOf, 'R1C1'), R1C2: stageOf(asOf, 'R1C2') }).toEqual(expected)
    }
  })
})

describe('HISTORY_FROM_LABEL', () => {
  it('names the day the work model landed, in the format the panel writes dates', () => {
    expect(HISTORY_FROM_LABEL).toBe('Lịch sử từ 24/08/2026')
  })
})
