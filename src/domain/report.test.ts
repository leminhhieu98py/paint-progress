import { describe, expect, it } from 'vitest'
import { buildEventRows, buildOverviewRows, buildPlanRows, reportStageColumns } from './report'
import type { DeckReportInput } from './report'
import type { DeckEvent } from '../lib/progressApi'

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]

/** CD: 500 m² at Tháo giáo, 500 at Coat 2, of 1000 declared. */
const CD: DeckReportInput = {
  deck: {
    id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000,
    cells: [
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0, h: 0, areaM2: 500, stageId: 's3' },
      { id: 'c2', code: 'R1C2', x: 0, y: 0, w: 0, h: 0, areaM2: 500, stageId: 's2' },
    ],
  },
  stages: STAGES,
  zones: [],
  events: [],
}

/** MD: 250 m² at Blast + Coat 1, of 1000 declared. */
const MD: DeckReportInput = {
  deck: {
    id: 'd2', code: 'MD', name: 'Main Deck', totalAreaM2: 1000,
    cells: [
      { id: 'c9', code: 'R1C1', x: 0, y: 0, w: 0, h: 0, areaM2: 250, stageId: 's1' },
    ],
  },
  stages: STAGES,
  zones: [],
  events: [],
}

describe('reportStageColumns', () => {
  it('lists the stages once, in sequence', () => {
    expect(reportStageColumns([CD, MD])).toEqual(['Blast + Coat 1', 'Coat 2', 'Tháo giáo'])
  })

  it('unions stages across decks that no longer share one spec', () => {
    // Stages belong to a deck since 0018, so two decks of one project can carry
    // different coat systems. The sheet keeps ONE row per deck -- that is the
    // habit the client already reads -- so the columns are the union, by name.
    // Keying on id would give near-duplicate columns for stages that are the
    // same coat under two ids.
    const helideck: DeckReportInput = {
      ...MD,
      stages: [
        { id: 'h1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.5 },
        { id: 'h2', seq: 2, name: 'Sơn chống trượt', color: '#eb2f96', weight: 0.5 },
      ],
    }

    expect(reportStageColumns([CD, helideck])).toEqual([
      'Blast + Coat 1', 'Coat 2', 'Sơn chống trượt', 'Tháo giáo',
    ])
  })

  it('orders a stage by the earliest seq any deck gives it', () => {
    // Two decks can number the same coat differently. Sorting by name would put
    // "Tháo giáo" before "Blast", which is the reverse of the work.
    const odd: DeckReportInput = {
      ...MD,
      stages: [{ id: 'x', seq: 1, name: 'Tháo giáo', color: '#722ed1', weight: 1 }],
    }
    expect(reportStageColumns([CD, odd])[0]).toBe('Blast + Coat 1')
  })

  it('returns nothing for a project with no decks', () => {
    expect(reportStageColumns([])).toEqual([])
  })
})

describe('buildOverviewRows', () => {
  it('gives each deck its share, area, per-stage figures and progress', () => {
    const [cd] = buildOverviewRows([CD, MD])

    expect(cd.name).toBe('Cellar Deck')
    expect(cd.code).toBe('CD')
    expect(cd.share).toBeCloseTo(0.5, 12)
    expect(cd.totalAreaM2).toBe(1000)
    // 500 at Tháo giáo has had all three; 500 at Coat 2 has had the first two.
    expect(cd.stageAreaM2).toEqual({
      'Blast + Coat 1': 1000, 'Coat 2': 1000, 'Tháo giáo': 500,
    })
    expect(cd.stageRatio['Tháo giáo']).toBeCloseTo(0.5, 12)
    // .25 + .15 + .6*.5 = .70
    expect(cd.progress).toBeCloseTo(0.7, 12)
    expect(cd.remain).toBeCloseTo(0.3, 12)
  })

  it('leaves a stage this deck does not declare blank, not zero', () => {
    // Blank and zero mean different things to somebody pricing the work: zero
    // says "declared and none done", blank says "not in this deck's spec".
    const helideck: DeckReportInput = {
      deck: {
        ...MD.deck,
        cells: [{ ...MD.deck.cells[0], stageId: 'h1' }],
      },
      stages: [{ id: 'h1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 1 }],
      zones: [],
      events: [],
    }
    const [, hd] = buildOverviewRows([CD, helideck])

    expect(hd.stageAreaM2['Blast + Coat 1']).toBe(250)
    expect('Coat 2' in hd.stageAreaM2).toBe(false)
    expect('Tháo giáo' in hd.stageAreaM2).toBe(false)
  })

  it('closes with the project rollup, weighted by area', () => {
    const rows = buildOverviewRows([CD, MD])
    const total = rows[rows.length - 1]

    expect(total.isTotal).toBe(true)
    expect(total.totalAreaM2).toBe(2000)
    expect(total.share).toBe(1)
    // Equal areas: (70% + 6,25%) / 2.
    expect(total.progress).toBeCloseTo(0.38125, 12)
    // The rollup's stage areas are the plain sums across decks.
    expect(total.stageAreaM2['Blast + Coat 1']).toBe(1250)
  })

  it('returns only the rollup for a project with no decks, rather than throwing', () => {
    const rows = buildOverviewRows([])
    expect(rows).toHaveLength(1)
    expect(rows[0].isTotal).toBe(true)
    expect(rows[0].progress).toBe(0)
  })
})

describe('buildPlanRows', () => {
  const planned: DeckReportInput = {
    ...CD,
    zones: [
      {
        id: 'z1', name: 'Khu A', stageId: 's3',
        startDate: '2026-09-01', finishDate: '2026-09-07',
        cellIds: ['c1'],
      },
    ],
  }

  it('gives each zone its deck, stage, area, dates and day count', () => {
    const [row] = buildPlanRows([planned])

    expect(row).toMatchObject({
      deckName: 'Cellar Deck',
      zoneName: 'Khu A',
      stageName: 'Tháo giáo',
      areaM2: 500,
      startDate: '2026-09-01',
      finishDate: '2026-09-07',
    })
    // Inclusive of both ends: 1 Sep to 7 Sep is seven days, not six. The
    // customer's own sheet counts its zone rows by plain difference, and its
    // author confirmed those rows are wrong -- see buildPlanRows.
    expect(row.days).toBe(7)
  })

  it('leaves the day count blank when either end is unknown', () => {
    const rows = buildPlanRows([{
      ...planned,
      zones: [{ ...planned.zones[0], finishDate: null }],
    }])
    expect(rows[0].days).toBeNull()
  })

  it('counts a one-day zone as one day', () => {
    const rows = buildPlanRows([{
      ...planned,
      zones: [{ ...planned.zones[0], finishDate: '2026-09-01' }],
    }])
    expect(rows[0].days).toBe(1)
  })

  it('sums only the cells the zone actually covers', () => {
    // cellIds are ids, and a zone naming a cell that is not on this deck -- a
    // stale list held across a deck change -- must contribute nothing rather
    // than throw.
    const rows = buildPlanRows([{
      ...planned,
      zones: [{ ...planned.zones[0], cellIds: ['c1', 'c2', 'not-here'] }],
    }])
    expect(rows[0].areaM2).toBe(1000)
  })

  it('names a stage the deck no longer declares rather than crashing', () => {
    // zones.stage_id is ON DELETE CASCADE, so this should not arise -- but a
    // report that throws takes the whole export with it.
    const rows = buildPlanRows([{
      ...planned,
      zones: [{ ...planned.zones[0], stageId: 'gone' }],
    }])
    expect(rows[0].stageName).toBe('—')
  })

  it('walks every deck, in the order given', () => {
    const rows = buildPlanRows([
      { ...MD, zones: [{ ...planned.zones[0], id: 'z9', name: 'Khu B' }] },
      planned,
    ])
    expect(rows.map((r) => r.zoneName)).toEqual(['Khu B', 'Khu A'])
  })

  it('returns nothing when no deck has a plan', () => {
    expect(buildPlanRows([CD, MD])).toEqual([])
  })
})

describe('buildEventRows', () => {
  const ev = (over: Partial<DeckEvent> = {}): DeckEvent => ({
    id: 1,
    cellCode: 'R1C1',
    cellAreaM2: 500,
    workName: 'Công việc chính',
    toStageName: 'Blast + Coat 1',
    at: '2026-08-20T10:00:00+00:00',
    byId: 'u1',
    note: '',
    reportNote: null,
    reportHidden: false,
    ...over,
  })
  const withEvents = (events: DeckEvent[]): DeckReportInput => ({
    ...CD, events, userNames: { u1: 'Nguyễn Văn A' },
  })

  it('lists one row per stage change, and none for a bay never touched', () => {
    // Linh, on the report: "GS cập nhật ô nào thì report có thêm 1 hàng. Không
    // thì thôi." R1C2 has been through nothing, so it is not here.
    const rows = buildEventRows(withEvents([
      ev({ id: 1, toStageName: 'Blast + Coat 1', at: '2026-08-20T10:00:00+00:00' }),
      ev({ id: 2, toStageName: 'Coat 2', at: '2026-08-21T10:00:00+00:00' }),
    ]))
    expect(rows).toEqual([
      { code: 'R1C1', areaM2: 500, stageName: 'Blast + Coat 1', at: '2026-08-20T10:00:00+00:00', byName: 'Nguyễn Văn A', note: '' },
      { code: 'R1C1', areaM2: 500, stageName: 'Coat 2', at: '2026-08-21T10:00:00+00:00', byName: 'Nguyễn Văn A', note: '' },
    ])
  })

  it('orders by bay code, then by time, so a bay reads top to bottom', () => {
    const rows = buildEventRows(withEvents([
      ev({ id: 1, cellCode: 'R2C1', at: '2026-08-20T10:00:00+00:00' }),
      ev({ id: 3, cellCode: 'R1C1', at: '2026-08-22T10:00:00+00:00', toStageName: 'Coat 2' }),
      ev({ id: 2, cellCode: 'R1C1', at: '2026-08-21T10:00:00+00:00' }),
    ]))
    expect(rows.map((r) => [r.code, r.stageName])).toEqual([
      ['R1C1', 'Blast + Coat 1'],
      ['R1C1', 'Coat 2'],
      ['R2C1', 'Blast + Coat 1'],
    ])
  })

  it('names a move back to not started', () => {
    const [row] = buildEventRows(withEvents([ev({ toStageName: null })]))
    expect(row.stageName).toBe('Chưa bắt đầu')
  })

  it('prints the note as written, the report version when there is one, and nothing when hidden', () => {
    // 0023: the admin's report copy and hide flag land here and nowhere else.
    const rows = buildEventRows(withEvents([
      ev({ id: 1, note: 'Bề mặt còn ẩm' }),
      ev({ id: 2, at: '2026-08-21T10:00:00+00:00', note: 'Bề mặt còn ẩm', reportNote: 'Bề mặt ẩm, đã sơn lại ngày sau' }),
      ev({ id: 3, at: '2026-08-22T10:00:00+00:00', note: 'Nói xấu sếp', reportHidden: true }),
    ]))
    expect(rows.map((r) => r.note)).toEqual(['Bề mặt còn ẩm', 'Bề mặt ẩm, đã sơn lại ngày sau', ''])
  })

  it('names the author through the map, falls back to the id, and leaves nobody as null', () => {
    // The id is still traceable through cell_events; a blank would read as
    // "nobody did this", which is a different and wrong claim.
    const rows = buildEventRows(withEvents([
      ev({ id: 1, byId: 'u1' }),
      ev({ id: 2, at: '2026-08-21T10:00:00+00:00', byId: 'u9' }),
      ev({ id: 3, at: '2026-08-22T10:00:00+00:00', byId: null }),
    ]))
    expect(rows.map((r) => r.byName)).toEqual(['Nguyễn Văn A', 'u9', null])
  })

  it('works with no name map at all', () => {
    const [row] = buildEventRows({ ...CD, events: [ev()] })
    expect(row.byName).toBe('u1')
  })
})
