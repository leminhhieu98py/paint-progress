import { describe, expect, it } from 'vitest'
import {
  dailyEffort, effortCoverage, effortDayKey, efficiencySeries, hoursSeries, leadEfficiency,
  stageEfficiency, stageOrder, wasteReasons, type StageOrder,
} from './effort'
import { EMPTY_EFFORT, type DeckEvent, type Effort, type WorkModel } from './types'

let nextId = 1
const event = (over: Partial<Omit<DeckEvent, 'effort'>> & { effort?: Partial<Effort> } = {}): DeckEvent => ({
  id: nextId++,
  deckName: 'Sàn A',
  cellCode: 'R1C1',
  cellAreaM2: 100,
  workName: 'Sơn',
  toStageName: 'Lớp 1',
  at: '2026-09-04T03:00:00Z',
  byId: 'u1',
  note: '',
  reportNote: null,
  reportHidden: false,
  effortEditedAt: null,
  effortEditedByName: null,
  ...over,
  effort: { ...EMPTY_EFFORT, ...(over.effort ?? {}) },
})

/**
 * Linh's workbook, Lớp 1: five days of (Mhr, m²). One event per day carrying
 * the whole day's hours over a bay of the day's area, so the daily ratio is
 * exactly the workbook's column I.
 */
const WORKBOOK_LOP1 = [
  ['2026-08-31', 277, 220], ['2026-09-01', 287, 225], ['2026-09-02', 291, 250],
  ['2026-09-03', 293, 255], ['2026-09-04', 296, 255],
] as const
const lop1Events = WORKBOOK_LOP1.map(([day, hours, area]) =>
  event({ at: `${day}T03:00:00Z`, cellAreaM2: area, effort: { workHours: hours } }))

describe('effortDayKey', () => {
  it('buckets by the Vietnam calendar day, not UTC', () => {
    // 16:30Z is 23:30 in Vietnam: still the 4th. 17:30Z is 00:30 on the 5th.
    expect(effortDayKey('2026-09-04T16:30:00Z')).toBe('2026-09-04')
    expect(effortDayKey('2026-09-04T17:30:00Z')).toBe('2026-09-05')
  })

  it('accepts the +00:00 offset form PostgREST returns', () => {
    expect(effortDayKey('2026-09-04T17:30:00+00:00')).toBe('2026-09-05')
  })
})

describe('dailyEffort', () => {
  it('sums hours and the area they covered per (work, stage, day), and divides', () => {
    const rows = dailyEffort([
      event({ cellCode: 'R1C1', cellAreaM2: 100, effort: { workHours: 3 } }),
      event({ cellCode: 'R1C2', cellAreaM2: 50, effort: { workHours: 1.5 } }),
    ])
    expect(rows).toEqual([{
      workName: 'Sơn', stageName: 'Lớp 1', day: '2026-09-04',
      hours: 4.5, areaM2: 150, mhrPerM2: 0.03, wasteHours: 0, updates: 2,
    }])
  })

  it('counts an event without hours as an update and for waste, but not in the ratio', () => {
    const rows = dailyEffort([
      event({ cellAreaM2: 100, effort: { workHours: 2 } }),
      event({ cellCode: 'R1C2', cellAreaM2: 400, effort: { workHours: null, wasteHours: 1 } }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ hours: 2, areaM2: 100, mhrPerM2: 0.02, wasteHours: 1, updates: 2 })
  })

  it('leaves the ratio null on a day with updates but no hours at all', () => {
    const rows = dailyEffort([event({ effort: { workHours: null } })])
    expect(rows[0]).toMatchObject({ hours: 0, areaM2: 0, mhrPerM2: null, updates: 1 })
  })

  it('splits days at Vietnam midnight and sorts by day', () => {
    const rows = dailyEffort([
      event({ at: '2026-09-04T17:30:00Z', effort: { workHours: 1 } }),
      event({ at: '2026-09-04T16:30:00Z', effort: { workHours: 2 } }),
    ])
    expect(rows.map((r) => [r.day, r.hours])).toEqual([['2026-09-04', 2], ['2026-09-05', 1]])
  })

  it('names a move back to not-started and a missing work', () => {
    const rows = dailyEffort([event({ toStageName: null, workName: null, effort: { workHours: 1 } })])
    expect(rows[0]).toMatchObject({ workName: '', stageName: 'Chưa bắt đầu' })
  })
})

describe('stageEfficiency', () => {
  const ORDER: StageOrder = new Map([['Sơn', ['Lớp 1', 'Lớp 2']]])

  it('reproduces the workbook: mean of daily ratios and mean daily hours, not total over total', () => {
    const [row] = stageEfficiency(dailyEffort(lop1Events), ORDER)
    expect(row.days).toBe(5)
    expect(row.totalHours).toBe(1444)
    expect(row.totalAreaM2).toBe(1205)
    // AVERAGEA(I4:I8) in the workbook.
    expect(row.avgMhrPerM2).toBeCloseTo(1.2016900772430186, 12)
    // AVERAGE(G4:G8).
    expect(row.avgHoursPerDay).toBeCloseTo(288.8, 12)
    // The figure it must NOT be.
    expect(row.avgMhrPerM2).not.toBeCloseTo(1444 / 1205, 3)
  })

  it('orders by work seq then stage seq, unknown stage names last', () => {
    const daily = dailyEffort([
      event({ toStageName: 'Lớp 2', effort: { workHours: 1 } }),
      event({ toStageName: 'Lớp cũ', effort: { workHours: 1 } }),
      event({ toStageName: 'Lớp 1', effort: { workHours: 1 } }),
      event({ workName: 'Tháo giáo', toStageName: 'Tháo', effort: { workHours: 1 } }),
    ])
    const order: StageOrder = new Map([['Sơn', ['Lớp 1', 'Lớp 2']], ['Tháo giáo', ['Tháo']]])
    expect(stageEfficiency(daily, order).map((r) => `${r.workName}/${r.stageName}`))
      .toEqual(['Sơn/Lớp 1', 'Sơn/Lớp 2', 'Sơn/Lớp cũ', 'Tháo giáo/Tháo'])
  })

  it('keeps a stage that only has waste, with null ratios and zero days', () => {
    const [row] = stageEfficiency(dailyEffort([event({ effort: { wasteHours: 2, wasteReason: 'Mưa' } })]), ORDER)
    expect(row).toMatchObject({ days: 0, totalHours: 0, avgMhrPerM2: null, avgHoursPerDay: null, wasteHours: 2 })
  })
})

describe('stageOrder', () => {
  it('lists each work\'s stage names by seq, once, works by seq', () => {
    const stage = (id: string, seq: number, name: string) => ({ id, seq, name, color: '#000', weight: 0.5 })
    const models: WorkModel[] = [
      {
        work: { id: 'w2', projectId: 'p', seq: 2, name: 'Tháo giáo', kind: 'bays', weight: 0.5, counts: true, manualProgress: 0 },
        decks: [{ deck: { id: 'd', code: 'D', name: 'D', totalAreaM2: 1, cells: [] }, weight: 1, stages: [stage('t', 1, 'Tháo')] }],
      },
      {
        work: { id: 'w1', projectId: 'p', seq: 1, name: 'Sơn', kind: 'bays', weight: 0.5, counts: true, manualProgress: 0 },
        decks: [
          { deck: { id: 'd', code: 'D', name: 'D', totalAreaM2: 1, cells: [] }, weight: 0.5, stages: [stage('s2', 2, 'Lớp 2'), stage('s1', 1, 'Lớp 1')] },
          { deck: { id: 'e', code: 'E', name: 'E', totalAreaM2: 1, cells: [] }, weight: 0.5, stages: [stage('s3', 1, 'Lớp 1'), stage('s4', 2, 'Lớp 3')] },
        ],
      },
    ]
    const order = stageOrder(models)
    expect([...order.keys()]).toEqual(['Sơn', 'Tháo giáo'])
    expect(order.get('Sơn')).toEqual(['Lớp 1', 'Lớp 2', 'Lớp 3'])
  })
})

describe('leadEfficiency', () => {
  it('groups by trimmed lead name, total over total, blank name kept as its own row', () => {
    const rows = leadEfficiency([
      event({ cellAreaM2: 100, effort: { leadName: 'Tổ 1 ', workHours: 10, wasteHours: 1 } }),
      event({ cellAreaM2: 100, effort: { leadName: 'Tổ 1', workHours: 5 } }),
      event({ cellAreaM2: 100, effort: { leadName: '', workHours: 2 } }),
      event({ cellAreaM2: 100, effort: { leadName: 'Tổ 2', workHours: null } }),
    ])
    expect(rows).toEqual([
      { leadName: 'Tổ 1', updates: 2, totalHours: 15, totalAreaM2: 200, mhrPerM2: 0.075, wasteHours: 1 },
      { leadName: '', updates: 1, totalHours: 2, totalAreaM2: 100, mhrPerM2: 0.02, wasteHours: 0 },
      { leadName: 'Tổ 2', updates: 1, totalHours: 0, totalAreaM2: 0, mhrPerM2: null, wasteHours: 0 },
    ])
  })
})

describe('wasteReasons', () => {
  it('sums lost hours per trimmed reason, most hours first, ignoring events without waste', () => {
    const rows = wasteReasons([
      event({ effort: { wasteHours: 1, wasteReason: 'Mưa ' } }),
      event({ effort: { wasteHours: 2.5, wasteReason: 'Chờ vật tư' } }),
      event({ effort: { wasteHours: 0.5, wasteReason: 'Mưa' } }),
      event({ effort: { wasteHours: 0, wasteReason: 'Nhầm' } }),
      event({ effort: { wasteHours: 1 } }),
    ])
    expect(rows).toEqual([
      { reason: 'Chờ vật tư', hours: 2.5, count: 1 },
      { reason: 'Mưa', hours: 1.5, count: 2 },
      { reason: '', hours: 1, count: 1 },
    ])
  })
})

describe('effortCoverage', () => {
  it('counts the events that carry hours against all of them', () => {
    expect(effortCoverage([
      event({ effort: { workHours: 1 } }), event({ effort: { workHours: 0 } }), event(),
    ])).toEqual({ withHours: 2, total: 3 })
  })
})

describe('series', () => {
  const daily = dailyEffort([
    event({ at: '2026-09-01T03:00:00Z', toStageName: 'Lớp 1', cellAreaM2: 100, effort: { workHours: 120, wasteHours: 3 } }),
    event({ at: '2026-09-01T03:00:00Z', toStageName: 'Lớp 2', cellAreaM2: 100, effort: { workHours: 110 } }),
    event({ at: '2026-09-02T03:00:00Z', toStageName: 'Lớp 1', cellAreaM2: 200, effort: { workHours: 220 } }),
    event({ at: '2026-09-03T03:00:00Z', toStageName: 'Lớp 1', effort: { wasteHours: 4, wasteReason: 'Mưa' } }),
  ])

  it('efficiencySeries: one point per day with a column per stage, skipping days without a ratio', () => {
    expect(efficiencySeries(daily)).toEqual([
      { day: '2026-09-01', 'Lớp 1': 1.2, 'Lớp 2': 1.1 },
      { day: '2026-09-02', 'Lớp 1': 1.1 },
    ])
  })

  it('hoursSeries: hours and lost hours per day, including a day that only lost hours', () => {
    expect(hoursSeries(daily)).toEqual([
      { day: '2026-09-01', hours: 230, wasteHours: 3 },
      { day: '2026-09-02', hours: 220, wasteHours: 0 },
      { day: '2026-09-03', hours: 0, wasteHours: 4 },
    ])
  })
})
