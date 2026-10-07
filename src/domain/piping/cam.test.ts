import { describe, expect, it } from 'vitest'
import {
  camGroupRows,
  camItems,
  camProgress,
  camSeries,
  camSeriesKeys,
  camSpoolFlags,
  duplicateSpoolGroups,
  filterOptions,
  filterSpools,
  groupLateWarnings,
  lateSpoolCount,
  lateWarnings,
  orderViolations,
  planOrderIssues,
  resolveActualChanges,
  rollupDates,
  spoolKey,
} from './cam'
import type { Spool } from './types'

const START = '2026-09-18'

let nextSeq = 1
const spool = (over: Partial<Spool> = {}): Spool => {
  const seq = over.seq ?? nextSeq++
  return {
    id: `s${seq}`,
    seq,
    spoolNo: `SP-${seq}`,
    lineNo: 'L1',
    insuType: 'HC',
    drawingNo: 'D1',
    testPackageNo: 'TP1',
    paintingSystem: 'BD-02B',
    extra: {},
    phPlan: null,
    ihPlan: null,
    iwPlan: null,
    phActual: null,
    ihActual: null,
    iwActual: null,
    ...over,
  }
}

describe('spoolKey', () => {
  it('trims spaces only, as Postgres btrim() does by default', () => {
    expect(spoolKey('  A-1  ')).toBe('A-1')
    expect(spoolKey('A-1\t')).toBe('A-1\t')
    expect(spoolKey('\u00a0A-1')).toBe('\u00a0A-1')
  })
})

describe('orderViolations (Q15B, Q18A)', () => {
  it('checks PH <= IH <= IW over the dates present only', () => {
    expect(orderViolations({ ph: '2026-09-01', ih: '2026-09-02', iw: '2026-09-03' })).toEqual([])
    expect(orderViolations({ ph: '2026-09-01', ih: '2026-09-01', iw: null })).toEqual([])
    expect(orderViolations({ ph: null, ih: null, iw: null })).toEqual([])
    expect(orderViolations({ ph: '2026-09-05', ih: '2026-09-02', iw: null })).toEqual([['ph', 'ih']])
    // With IH missing, PH is still compared with IW.
    expect(orderViolations({ ph: '2026-09-05', ih: null, iw: '2026-09-02' })).toEqual([['ph', 'iw']])
    expect(orderViolations({ ph: '2026-09-05', ih: '2026-09-04', iw: '2026-09-03' }))
      .toEqual([['ph', 'ih'], ['ph', 'iw'], ['ih', 'iw']])
  })
})

describe('rollupDates (Q17A, R-13)', () => {
  it('reaches a milestone on the last spool\'s date, only when every spool has one', () => {
    const a = spool({ phActual: '2026-09-01', phPlan: '2026-09-03', ihPlan: '2026-09-10' })
    const b = spool({ phActual: '2026-09-04', phPlan: '2026-09-02', ihPlan: null })
    const c = spool({ phActual: null, phPlan: '2026-09-05' })
    expect(rollupDates([a, b])).toEqual({
      plan: { ph: '2026-09-03', ih: null, iw: null },
      actual: { ph: '2026-09-04', ih: null, iw: null },
    })
    expect(rollupDates([a, b, c]).actual.ph).toBeNull()
    expect(rollupDates([a, b, c]).plan.ph).toBe('2026-09-05')
  })
})

describe('camItems (spec §6.4 units)', () => {
  const spools = [
    spool({ seq: 1, spoolNo: 'A', lineNo: 'L1', phActual: '2026-09-01' }),
    spool({ seq: 2, spoolNo: 'A', lineNo: 'L1', phActual: '2026-09-03' }),
    spool({ seq: 3, spoolNo: 'B', lineNo: 'L2', phActual: null }),
    spool({ seq: 4, spoolNo: 'C', lineNo: '  ', phActual: '2026-09-02' }),
  ]

  it('counts spool rows for SpoolNo, duplicates included', () => {
    const items = camItems(spools, 'spoolNo')
    expect(items.map((i) => [i.key, i.label, i.actual.ph])).toEqual([
      ['s1', 'A', '2026-09-01'],
      ['s2', 'A', '2026-09-03'],
      ['s3', 'B', null],
      ['s4', 'C', '2026-09-02'],
    ])
  })

  it('counts distinct non-blank values for every other unit, a blank value belonging to no group', () => {
    const items = camItems(spools, 'lineNo')
    expect(items.map((i) => [i.key, i.spools.length, i.actual.ph])).toEqual([
      ['L1', 2, '2026-09-03'],
      ['L2', 1, null],
    ])
  })
})

describe('camProgress (spec §6.4 summary)', () => {
  const spools = [
    spool({ seq: 1, lineNo: 'L1', phActual: '2026-09-01', ihActual: '2026-09-02' }),
    spool({ seq: 2, lineNo: 'L1', phActual: '2026-09-03' }),
    spool({ seq: 3, lineNo: 'L2', phActual: null }),
    spool({ seq: 4, lineNo: null, phActual: '2026-09-02', iwActual: '2026-09-04' }),
  ]

  it('counts spool rows done per milestone for SpoolNo', () => {
    expect(camProgress(spools, 'spoolNo')).toEqual({ total: 4, done: { ph: 3, ih: 1, iw: 1 } })
  })

  it('counts a group done only when all its spools are, blank values in no group (R-13)', () => {
    expect(camProgress(spools, 'lineNo')).toEqual({ total: 2, done: { ph: 1, ih: 0, iw: 0 } })
  })

  it('is zero over no spools', () => {
    expect(camProgress([], 'spoolNo')).toEqual({ total: 0, done: { ph: 0, ih: 0, iw: 0 } })
  })
})

describe('camSeries (spec §6.4 chart)', () => {
  const spools = [
    spool({ phPlan: '2026-09-18', ihPlan: '2026-09-20', phActual: '2026-09-19' }),
    spool({ phPlan: '2026-09-19', ihPlan: '2026-09-22', phActual: '2026-09-19', ihActual: '2026-09-20' }),
  ]

  it('gives six cumulative lines, plan to the plan\'s overall end and actual to today', () => {
    const { points, total } = camSeries({ spools, unit: 'spoolNo', mode: 'day', weekStart: START, todayKey: '2026-09-20' })
    expect(total).toBe(2)
    expect(points.map((p) => [p.key, p.phPlan, p.phActual, p.ihPlan, p.ihActual, p.iwPlan, p.iwActual])).toEqual([
      ['2026-09-18', 1, 0, 0, 0, 0, 0],
      ['2026-09-19', 2, 2, 0, 0, 0, 0],
      ['2026-09-20', 2, 2, 1, 1, 0, 0],
      ['2026-09-21', 2, null, 1, null, 0, null],
      ['2026-09-22', 2, null, 2, null, 0, null],
    ])
  })

  it('counts a group on the date of its last spool (Line unit), in weeks', () => {
    const { points, total } = camSeries({ spools, unit: 'lineNo', mode: 'week', weekStart: START, todayKey: '2026-09-30' })
    expect(total).toBe(1)
    expect(points.map((p) => [p.key, p.phPlan, p.phActual, p.ihActual])).toEqual([
      ['2026-09-18', 1, 1, 0],
      ['2026-09-25', null, 1, 0],
    ])
  })

  it('is empty without any date', () => {
    expect(camSeries({ spools: [spool()], unit: 'spoolNo', mode: 'day', weekStart: START, todayKey: '2026-09-20' }))
      .toEqual({ points: [], total: 1 })
  })

  it('names the lines a Plan | Actual | Plan & Actual toggle shows (Q20A)', () => {
    expect(camSeriesKeys('plan')).toEqual(['phPlan', 'ihPlan', 'iwPlan'])
    expect(camSeriesKeys('actual')).toEqual(['phActual', 'ihActual', 'iwActual'])
    expect(camSeriesKeys('both')).toEqual(['phPlan', 'phActual', 'ihPlan', 'ihActual', 'iwPlan', 'iwActual'])
  })
})

describe('camGroupRows (Q16B)', () => {
  const spools = [
    spool({ testPackageNo: 'TP1', lineNo: 'L1', phPlan: '2026-09-01', phActual: '2026-09-02' }),
    spool({ testPackageNo: 'TP1', lineNo: 'L2', phPlan: '2026-09-03' }),
    spool({ testPackageNo: 'TP2', lineNo: 'L2', phActual: '2026-09-04' }),
    spool({ testPackageNo: null, lineNo: 'L3' }),
  ]

  it('rolls up by Test Package No with done/planned/total per milestone', () => {
    const rows = camGroupRows(spools, 'package')
    expect(rows.map((r) => [r.key, r.spools.length, r.counts.ph])).toEqual([
      ['', 1, { done: 0, planned: 0, total: 1 }],
      ['TP1', 2, { done: 1, planned: 2, total: 2 }],
      ['TP2', 1, { done: 1, planned: 0, total: 1 }],
    ])
    expect(rows[1].plan.ph).toBe('2026-09-03')
    expect(rows[1].actual.ph).toBeNull()
  })

  it('groups by LineNo on its own, across packages', () => {
    const rows = camGroupRows(spools, 'line')
    expect(rows.map((r) => [r.key, r.spools.length])).toEqual([['L1', 1], ['L2', 2], ['L3', 1]])
    expect(rows[1].actual.ph).toBeNull()
  })
})

describe('filters', () => {
  const spools = [
    spool({ spoolNo: 'PP-1', lineNo: 'LINE-A', insuType: 'HC', paintingSystem: 'BD-02B', testPackageNo: 'TP1' }),
    spool({ spoolNo: 'PP-2', lineNo: 'LINE-B', insuType: 'PP', paintingSystem: 'BD-02C', testPackageNo: 'TP2' }),
    spool({ spoolNo: 'QQ-3', lineNo: 'LINE-A', insuType: 'HC', paintingSystem: 'BD-02C', testPackageNo: null }),
  ]
  const none = { insuTypes: [], paintingSystems: [], testPackageNos: [], search: '' }

  it('passes everything with no filter', () => {
    expect(filterSpools(spools, none)).toHaveLength(3)
  })

  it('combines the selects with AND, and a value list with OR', () => {
    expect(filterSpools(spools, { ...none, insuTypes: ['HC'] }).map((s) => s.spoolNo)).toEqual(['PP-1', 'QQ-3'])
    expect(filterSpools(spools, { ...none, insuTypes: ['HC'], paintingSystems: ['BD-02C'] }).map((s) => s.spoolNo))
      .toEqual(['QQ-3'])
    expect(filterSpools(spools, { ...none, testPackageNos: ['TP1', 'TP2'] }).map((s) => s.spoolNo)).toEqual(['PP-1', 'PP-2'])
  })

  it('searches SpoolNo and LineNo, case-insensitive, trimmed', () => {
    expect(filterSpools(spools, { ...none, search: ' line-b ' }).map((s) => s.spoolNo)).toEqual(['PP-2'])
    expect(filterSpools(spools, { ...none, search: 'qq' }).map((s) => s.spoolNo)).toEqual(['QQ-3'])
  })

  it('sorts values numerically and without regard to case', () => {
    const rows = [spool({ insuType: 'TP10' }), spool({ insuType: 'tp3' }), spool({ insuType: 'TP2' })]
    expect(filterOptions(rows).insuTypes).toEqual(['TP2', 'tp3', 'TP10'])
  })

  it('offers the distinct non-blank values, sorted', () => {
    expect(filterOptions(spools)).toEqual({
      insuTypes: ['HC', 'PP'],
      paintingSystems: ['BD-02B', 'BD-02C'],
      testPackageNos: ['TP1', 'TP2'],
    })
  })
})

describe('duplicateSpoolGroups (Q14C)', () => {
  it('lists every SpoolNo that occurs more than once, trimmed, in file order', () => {
    const rows = [
      { spoolNo: 'B', seq: 1 }, { spoolNo: 'A', seq: 2 }, { spoolNo: 'B ', seq: 3 }, { spoolNo: 'C', seq: 4 }, { spoolNo: 'A', seq: 5 },
    ]
    expect(duplicateSpoolGroups(rows)).toEqual([
      { spoolNo: 'B', rows: [rows[0], rows[2]] },
      { spoolNo: 'A', rows: [rows[1], rows[4]] },
    ])
  })
})

describe('planOrderIssues (Q15B)', () => {
  it('lists the rows whose plan dates break PH <= IH <= IW', () => {
    const ok = spool({ phPlan: '2026-09-01', ihPlan: '2026-09-02' })
    const bad = spool({ phPlan: '2026-09-05', iwPlan: '2026-09-01' })
    expect(planOrderIssues([ok, bad])).toEqual([{ row: bad, pairs: [['ph', 'iw']] }])
  })
})

describe('resolveActualChanges (Q18A, spec §6.3)', () => {
  const a = spool({ id: 'a', spoolNo: 'A', phActual: '2026-09-01' })
  const b = spool({ id: 'b', spoolNo: 'B', ihActual: '2026-09-05' })
  const c = spool({ id: 'c', spoolNo: 'C' })
  const today = '2026-10-07'

  it('saves a new date, lists an overwrite old -> new, and counts an equal date as unchanged', () => {
    const res = resolveActualChanges([a, b, c], [
      { spoolId: 'a', milestone: 'ph', date: '2026-09-03' },
      { spoolId: 'a', milestone: 'ih', date: '2026-09-04' },
      { spoolId: 'c', milestone: 'ph', date: '2026-09-02' },
      { spoolId: 'b', milestone: 'ih', date: '2026-09-05' },
    ], today)
    expect(res.updates).toEqual([
      { spoolId: 'a', spoolNo: 'A', changes: [{ milestone: 'ph', date: '2026-09-03' }, { milestone: 'ih', date: '2026-09-04' }] },
      { spoolId: 'c', spoolNo: 'C', changes: [{ milestone: 'ph', date: '2026-09-02' }] },
    ])
    expect(res.overwrites).toEqual([{ spoolId: 'a', spoolNo: 'A', milestone: 'ph', from: '2026-09-01', to: '2026-09-03' }])
    expect(res.unchanged).toEqual([{ spoolId: 'b', spoolNo: 'B', milestone: 'ih' }])
    expect(res.rejected).toEqual([])
  })

  it('rejects a whole spool whose result breaks the order, and skips it while the rest go through', () => {
    const res = resolveActualChanges([a, b], [
      { spoolId: 'b', milestone: 'ph', date: '2026-09-06' },
      { spoolId: 'a', milestone: 'ih', date: '2026-09-02' },
    ], today)
    expect(res.updates.map((u) => u.spoolId)).toEqual(['a'])
    expect(res.rejected).toEqual([{
      spoolId: 'b',
      spoolNo: 'B',
      reason: 'order',
      message: 'Sai thứ tự: Painting Handover (06/09/2026) sau Insulation Handover (05/09/2026)',
    }])
  })

  it('rejects a date after today and an unknown spool', () => {
    const res = resolveActualChanges([a], [
      { spoolId: 'a', milestone: 'ih', date: '2026-10-08' },
      { spoolId: 'zz', milestone: 'ph', date: '2026-09-01' },
    ], today)
    expect(res.updates).toEqual([])
    expect(res.rejected).toEqual([
      { spoolId: 'a', spoolNo: 'A', reason: 'future', message: 'Insulation Handover: ngày 08/10/2026 sau hôm nay' },
      { spoolId: 'zz', spoolNo: '', reason: 'notFound', message: 'Không tìm thấy spool' },
    ])
  })

  it('treats a null date as clearing, listed as an overwrite to null', () => {
    const res = resolveActualChanges([a], [{ spoolId: 'a', milestone: 'ph', date: null }], today)
    expect(res.updates).toEqual([{ spoolId: 'a', spoolNo: 'A', changes: [{ milestone: 'ph', date: null }] }])
    expect(res.overwrites).toEqual([{ spoolId: 'a', spoolNo: 'A', milestone: 'ph', from: '2026-09-01', to: null }])
  })
})

describe('late warnings (spec §7)', () => {
  const today = '2026-10-07'
  const spools = [
    // Actual 8 days after plan, threshold 7: late by 8.
    spool({ id: 'a', spoolNo: 'A', lineNo: 'L1', testPackageNo: 'TP1', phPlan: '2026-09-01', phActual: '2026-09-09' }),
    // Actual exactly plan + 7: not late.
    spool({ id: 'b', spoolNo: 'B', lineNo: 'L1', testPackageNo: 'TP2', phPlan: '2026-09-01', phActual: '2026-09-08' }),
    // No actual, today > plan + 7: late by today - plan; IW too.
    spool({ id: 'c', spoolNo: 'C', lineNo: 'L2', testPackageNo: 'TP1', ihPlan: '2026-09-29', iwPlan: '2026-09-20' }),
    // No actual, today = plan + 7: not late. No plan: never late.
    spool({ id: 'd', spoolNo: 'D', lineNo: 'L2', testPackageNo: 'TP2', ihPlan: '2026-09-30', iwActual: '2026-10-01' }),
  ]

  it('flags actual > plan + N, or no actual and today > plan + N, with the department', () => {
    expect(lateWarnings(spools, 7, today)).toEqual([
      { spoolId: 'a', spoolNo: 'A', lineNo: 'L1', testPackageNo: 'TP1', milestone: 'ph', department: 'Piping', plan: '2026-09-01', actual: '2026-09-09', daysLate: 8 },
      { spoolId: 'c', spoolNo: 'C', lineNo: 'L2', testPackageNo: 'TP1', milestone: 'ih', department: 'Painting', plan: '2026-09-29', actual: null, daysLate: 8 },
      { spoolId: 'c', spoolNo: 'C', lineNo: 'L2', testPackageNo: 'TP1', milestone: 'iw', department: 'Insulation', plan: '2026-09-20', actual: null, daysLate: 17 },
    ])
  })

  it('reads a threshold of 0 as late the day after the plan', () => {
    expect(lateWarnings([spool({ phPlan: '2026-10-06' })], 0, today)).toHaveLength(1)
    expect(lateWarnings([spool({ phPlan: '2026-10-07' })], 0, today)).toHaveLength(0)
  })

  it('counts late spools once each, and groups the warnings by Package or by Line', () => {
    const warnings = lateWarnings(spools, 7, today)
    expect(lateSpoolCount(warnings)).toBe(2)
    expect(groupLateWarnings(warnings, 'package').map((g) => [g.key, g.warnings.length])).toEqual([['TP1', 3]])
    expect(groupLateWarnings(warnings, 'line').map((g) => [g.key, g.warnings.length])).toEqual([['L1', 1], ['L2', 2]])
  })

  it('flags each spool for the table: duplicate SpoolNo, plan-order issue, late milestones', () => {
    const rows = [
      spool({ id: 'x', spoolNo: 'X', phPlan: '2026-09-10', ihPlan: '2026-09-01' }),
      spool({ id: 'y', spoolNo: 'X' }),
      spool({ id: 'z', spoolNo: 'Z' }),
    ]
    const flags = camSpoolFlags(rows, 7, today)
    expect(flags.get('x')).toEqual({ duplicate: true, planOrder: true, late: ['ph', 'ih'] })
    expect(flags.get('y')).toEqual({ duplicate: true, planOrder: false, late: [] })
    expect(flags.get('z')).toEqual({ duplicate: false, planOrder: false, late: [] })
  })
})
