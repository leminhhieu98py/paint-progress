import { describe, expect, it } from 'vitest'
import {
  buildEventRows, buildOverview, buildPlanRows, planImagePairs, reportStageColumns, type DeckReportInput,
} from './report'
import type { DeckEvent } from '../lib/progressApi'
import { EMPTY_EFFORT, type Cell, type Work, type WorkModel } from './types'

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]
const TG_STAGES = [{ id: 't1', seq: 1, name: 'Tháo giáo lửng', color: '#8B5CF6', weight: 1 }]

const bay = (id: string, code: string, areaM2: number, stageId: string | null): Cell => ({
  id, code, x: 0, y: 0, w: 0, h: 0, areaM2, stageId, note: '',
})
const CD_META = { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000 }
const MD_META = { id: 'd2', code: 'MD', name: 'Main Deck', totalAreaM2: 1000 }
const work = (
  id: string, seq: number, name: string, kind: Work['kind'], weight: number, over: Partial<Work> = {},
): Work => ({ id, projectId: 'p1', seq, name, kind, weight, counts: true, manualProgress: 0, ...over })

/**
 * Sơn (W .5): CD has 500 m² at Tháo giáo and 500 at Coat 2 of 1000 -> 70%;
 * MD has 250 at Blast of 1000 -> 6,25%. D .5 each -> P_w = 38,125%.
 */
const SON: WorkModel = {
  work: work('w1', 1, 'Sơn', 'bays', 0.5),
  decks: [
    { deck: { ...CD_META, cells: [bay('c1', 'R1C1', 500, 's3'), bay('c2', 'R1C2', 500, 's2')] }, stages: STAGES, weight: 0.5 },
    { deck: { ...MD_META, cells: [bay('c9', 'R1C1', 250, 's1')] }, stages: STAGES, weight: 0.5 },
  ],
}
/** Tháo giáo (W .3): CD only, 500 of 1000 at its one coat -> 50%. */
const TG: WorkModel = {
  work: work('w2', 2, 'Tháo giáo', 'bays', 0.3),
  decks: [
    { deck: { ...CD_META, cells: [bay('c1', 'R1C1', 500, 't1'), bay('c2', 'R1C2', 500, null)] }, stages: TG_STAGES, weight: 1 },
  ],
}
/** Chứng từ (W .2): a manual figure, 50%. */
const PAPER: WorkModel = {
  work: work('w3', 3, 'Chứng từ', 'manual', 0.2, { manualProgress: 0.5 }),
  decks: [],
}
/** P = .5·.38125 + .3·.5 + .2·.5 = 44,0625%. */
const MODELS = [SON, TG, PAPER]

const CD: DeckReportInput = {
  deck: { ...CD_META, cells: [bay('c1', 'R1C1', 500, null), bay('c2', 'R1C2', 500, null)] },
  zones: [],
  events: [],
}
const MD: DeckReportInput = {
  deck: { ...MD_META, cells: [bay('c9', 'R1C1', 250, null)] },
  zones: [],
  events: [],
}

describe('reportStageColumns', () => {
  it('lists the stages once, in sequence', () => {
    expect(reportStageColumns(SON.decks)).toEqual(['Blast + Coat 1', 'Coat 2', 'Tháo giáo'])
  })

  it('unions stages across decks that do not share one spec', () => {
    // A coat list belongs to a (work, deck), so two decks of one work can
    // carry different coat systems. The block keeps ONE row per deck -- that is
    // the habit the client already reads -- so the columns are the union, by
    // name. Keying on id would give near-duplicate columns for the same coat.
    const helideck = {
      ...SON.decks[1],
      stages: [
        { id: 'h1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.5 },
        { id: 'h2', seq: 2, name: 'Sơn chống trượt', color: '#eb2f96', weight: 0.5 },
      ],
    }
    expect(reportStageColumns([SON.decks[0], helideck])).toEqual([
      'Blast + Coat 1', 'Coat 2', 'Sơn chống trượt', 'Tháo giáo',
    ])
  })

  it('orders a stage by the earliest seq any deck gives it', () => {
    // Two decks can number the same coat differently. Sorting by name would put
    // "Tháo giáo" before "Blast", which is the reverse of the work.
    const odd = {
      ...SON.decks[1],
      stages: [{ id: 'x', seq: 1, name: 'Tháo giáo', color: '#722ed1', weight: 1 }],
    }
    expect(reportStageColumns([SON.decks[0], odd])[0]).toBe('Blast + Coat 1')
  })

  it('returns nothing for a work with no decks', () => {
    expect(reportStageColumns([])).toEqual([])
  })
})

describe('buildOverview', () => {
  it('makes one block per bays work, in seq order, and none for a manual work', () => {
    const { blocks } = buildOverview(MODELS)
    expect(blocks.map((b) => b.work.name)).toEqual(['Sơn', 'Tháo giáo'])
  })

  it('gives each participating deck its D, area, per-stage figures and P_wd', () => {
    const [son, tg] = buildOverview(MODELS).blocks
    const [cd, md] = son.rows

    expect(cd.name).toBe('Cellar Deck')
    expect(cd.code).toBe('CD')
    expect(cd.share).toBeCloseTo(0.5, 12)
    expect(cd.totalAreaM2).toBe(1000)
    // 500 at Tháo giáo has had all three; 500 at Coat 2 has had the first two.
    expect(cd.stageAreaM2).toEqual({ 'Blast + Coat 1': 1000, 'Coat 2': 1000, 'Tháo giáo': 500 })
    expect(cd.stageRatio['Tháo giáo']).toBeCloseTo(0.5, 12)
    // .25 + .15 + .6*.5 = .70
    expect(cd.progress).toBeCloseTo(0.7, 12)
    expect(cd.remain).toBeCloseTo(0.3, 12)
    expect(md.progress).toBeCloseTo(0.0625, 12)
    // Only the decks in the work: Tháo giáo has no Main Deck row.
    expect(tg.rows.map((r) => r.code)).toEqual(['CD'])
    expect(tg.rows[0].progress).toBeCloseTo(0.5, 12)
  })

  it('carries each block\'s own stage columns and weights', () => {
    const [son, tg] = buildOverview(MODELS).blocks
    expect(son.stageNames).toEqual(['Blast + Coat 1', 'Coat 2', 'Tháo giáo'])
    expect(son.weights['Tháo giáo']).toBe(0.6)
    expect(tg.stageNames).toEqual(['Tháo giáo lửng'])
    expect(tg.weights['Tháo giáo lửng']).toBe(1)
  })

  it('leaves a stage a deck does not declare blank, not zero', () => {
    // Blank and zero mean different things to somebody pricing the work: zero
    // says "declared and none done", blank says "not in this deck's spec".
    const helideck = {
      deck: { ...MD_META, cells: [bay('c9', 'R1C1', 250, 'h1')] },
      stages: [{ id: 'h1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 1 }],
      weight: 0.5,
    }
    const [block] = buildOverview([{ ...SON, decks: [SON.decks[0], helideck] }]).blocks
    const hd = block.rows[1]

    expect(hd.stageAreaM2['Blast + Coat 1']).toBe(250)
    expect('Coat 2' in hd.stageAreaM2).toBe(false)
    expect('Tháo giáo' in hd.stageAreaM2).toBe(false)
  })

  it('closes each block with the work subtotal P_w, weighted by D', () => {
    const [son, tg] = buildOverview(MODELS).blocks

    expect(son.subtotal.isTotal).toBe(true)
    expect(son.subtotal.share).toBeCloseTo(1, 12)         // Σ D
    expect(son.subtotal.totalAreaM2).toBe(2000)
    // .5·70% + .5·6,25%
    expect(son.subtotal.progress).toBeCloseTo(0.38125, 12)
    expect(son.subtotal.remain).toBeCloseTo(0.61875, 12)
    // The subtotal's stage areas are plain sums across the block's decks.
    expect(son.subtotal.stageAreaM2['Blast + Coat 1']).toBe(1250)
    expect(tg.subtotal.progress).toBeCloseTo(0.5, 12)
  })

  it('lists the manual works with their figure, then the project total P', () => {
    const { manual, total } = buildOverview(MODELS)
    expect(manual.map((m) => [m.work.name, m.progress])).toEqual([['Chứng từ', 0.5]])
    expect(total.progress).toBeCloseTo(0.440625, 12)
    expect(total.remain).toBeCloseTo(0.559375, 12)
  })

  it('keeps a work that does not count on the sheet, and out of P', () => {
    const { blocks, total } = buildOverview([SON, { ...TG, work: { ...TG.work, counts: false } }, PAPER])
    expect(blocks[1].work.counts).toBe(false)
    expect(blocks[1].subtotal.progress).toBeCloseTo(0.5, 12)
    // .5·.38125 + .2·.5, Tháo giáo left out.
    expect(total.progress).toBeCloseTo(0.290625, 12)
  })

  it('returns no blocks and a zero total for a project with no works, rather than throwing', () => {
    const { blocks, manual, total } = buildOverview([])
    expect(blocks).toEqual([])
    expect(manual).toEqual([])
    expect(total.progress).toBe(0)
  })
})

describe('buildPlanRows', () => {
  const planned: DeckReportInput = {
    ...CD,
    zones: [
      {
        id: 'z1', name: 'Khu A', stageId: 's3', color: null,
        startDate: '2026-09-01', finishDate: '2026-09-07',
        cellIds: ['c1'],
      },
    ],
  }

  it('gives each zone its deck, work, stage, area, dates and day count', () => {
    const [row] = buildPlanRows([planned], MODELS)

    expect(row).toMatchObject({
      deckName: 'Cellar Deck',
      zoneName: 'Khu A',
      workName: 'Sơn',
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

  it('finds the work through the coat the zone plans', () => {
    // A zone is planned against a coat, and a coat belongs to a (work, deck).
    const rows = buildPlanRows([{ ...planned, zones: [{ ...planned.zones[0], stageId: 't1' }] }], MODELS)
    expect(rows[0]).toMatchObject({ workName: 'Tháo giáo', stageName: 'Tháo giáo lửng' })
  })

  it('leaves the day count blank when either end is unknown', () => {
    const rows = buildPlanRows([{
      ...planned,
      zones: [{ ...planned.zones[0], finishDate: null }],
    }], MODELS)
    expect(rows[0].days).toBeNull()
  })

  it('counts a one-day zone as one day', () => {
    const rows = buildPlanRows([{
      ...planned,
      zones: [{ ...planned.zones[0], finishDate: '2026-09-01' }],
    }], MODELS)
    expect(rows[0].days).toBe(1)
  })

  it('sums only the cells the zone actually covers', () => {
    // cellIds are ids, and a zone naming a cell that is not on this deck -- a
    // stale list held across a deck change -- must contribute nothing rather
    // than throw.
    const rows = buildPlanRows([{
      ...planned,
      zones: [{ ...planned.zones[0], cellIds: ['c1', 'c2', 'not-here'] }],
    }], MODELS)
    expect(rows[0].areaM2).toBe(1000)
  })

  it('names a stage no work declares rather than crashing', () => {
    // zones.stage_id is ON DELETE CASCADE, so this should not arise -- but a
    // report that throws takes the whole export with it.
    const rows = buildPlanRows([{
      ...planned,
      zones: [{ ...planned.zones[0], stageId: 'gone' }],
    }], MODELS)
    expect(rows[0].stageName).toBe('—')
    expect(rows[0].workName).toBe('—')
  })

  it('walks every deck, in the order given', () => {
    const rows = buildPlanRows([
      { ...MD, zones: [{ ...planned.zones[0], id: 'z9', name: 'Khu B', stageId: 's1' }] },
      planned,
    ], MODELS)
    expect(rows.map((r) => r.zoneName)).toEqual(['Khu B', 'Khu A'])
  })

  it('returns nothing when no deck has a plan', () => {
    expect(buildPlanRows([CD, MD], MODELS)).toEqual([])
  })
})

describe('buildEventRows', () => {
  const ev = (over: Partial<DeckEvent> = {}): DeckEvent => ({
    id: 1,
    cellCode: 'R1C1',
    cellAreaM2: 500,
    workName: 'Sơn',
    toStageName: 'Blast + Coat 1',
    at: '2026-08-20T10:00:00+00:00',
    byId: 'u1',
    note: '',
    reportNote: null,
    reportHidden: false,
    deckName: 'Cellar Deck',
    effort: EMPTY_EFFORT,
    effortEditedAt: null,
    effortEditedByName: null,
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
      { code: 'R1C1', areaM2: 500, workName: 'Sơn', stageName: 'Blast + Coat 1', at: '2026-08-20T10:00:00+00:00', byName: 'Nguyễn Văn A', note: '' },
      { code: 'R1C1', areaM2: 500, workName: 'Sơn', stageName: 'Coat 2', at: '2026-08-21T10:00:00+00:00', byName: 'Nguyễn Văn A', note: '' },
    ])
  })

  it('names the work each change belongs to, since one bay moves in several', () => {
    const rows = buildEventRows(withEvents([
      ev({ id: 1, workName: 'Tháo giáo', toStageName: 'Tháo giáo lửng' }),
      ev({ id: 2, at: '2026-08-21T10:00:00+00:00', workName: null }),
    ]))
    expect(rows.map((r) => r.workName)).toEqual(['Tháo giáo', ''])
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

describe('planImagePairs', () => {
  const zone = (id: string, stageId: string, cellIds: string[], color: string | null = null) => ({
    id, name: `Zone ${id}`, stageId, color, startDate: '2026-09-01', finishDate: '2026-09-07', cellIds,
  })

  it('gives one picture per (deck, work) that has a plan, coloured off that work\'s coats', () => {
    // CD has a zone on Sơn's Tháo giáo and one on Tháo giáo's own coat: two
    // pictures. MD has no plan: none.
    const planned: DeckReportInput = { ...CD, zones: [zone('z1', 's3', ['c1']), zone('z2', 't1', ['c2'])] }
    const pairs = planImagePairs([planned, MD], MODELS)

    expect(pairs.map((p) => [p.deckName, p.workName, p.lastStage.name])).toEqual([
      ['Cellar Deck', 'Sơn', 'Tháo giáo'],
      ['Cellar Deck', 'Tháo giáo', 'Tháo giáo lửng'],
    ])
    // Each picture carries only its own work's zones and that work's states.
    expect(pairs[0].zones.map((z) => z.id)).toEqual(['z1'])
    expect(pairs[0].cells.find((c) => c.code === 'R1C1')?.stageId).toBe('s3')
    expect(pairs[1].zones.map((z) => z.id)).toEqual(['z2'])
    expect(pairs[1].cells.find((c) => c.code === 'R1C1')?.stageId).toBe('t1')
    // Palette colour off the coats: magenta is free on both works.
    expect(pairs[0].zoneColors.z1).toBe('#eb2f96')
  })

  it('keeps a chosen zone colour', () => {
    const planned: DeckReportInput = { ...CD, zones: [zone('z1', 's3', ['c1'], '#13c2c2')] }
    expect(planImagePairs([planned], MODELS)[0].zoneColors.z1).toBe('#13c2c2')
  })

  it('gives a deck with no plan no picture, and ignores manual works', () => {
    expect(planImagePairs([CD, MD], MODELS)).toEqual([])
  })
})
