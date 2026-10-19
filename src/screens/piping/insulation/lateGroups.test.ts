import { describe, expect, it } from 'vitest'
import type { LateWarning } from '../../../domain/piping/cam'
import { lateFact, lateGroupRows, lateRule, lateSpoolRows, lateWarningMatches } from './lateGroups'

const warning = (spoolId: string, over: Partial<LateWarning> = {}): LateWarning => ({
  spoolId, spoolNo: `SP-${spoolId}`, lineNo: 'L1', testPackageNo: 'TP1', milestone: 'ph', department: 'Piping',
  plan: '2026-09-01', actual: null, daysLate: 10, ...over,
})

describe('lateRule', () => {
  it('states the threshold in days', () => {
    expect(lateRule(7)).toBe('Spool có ít nhất một mốc trễ quá 7 ngày so với ngày Plan (chưa có Actual thì tính đến hôm nay)')
  })
})

describe('lateFact', () => {
  it('counts distinct late spools in an amber pill that explains the threshold', () => {
    const fact = lateFact([warning('a'), warning('a', { milestone: 'ih' }), warning('b')], 5)
    expect(fact).toEqual({ value: '2', label: 'spool trễ', tone: 'warning', info: lateRule(5) })
  })

  it('is absent when no spool is late', () => {
    expect(lateFact([], 7)).toBeNull()
  })
})

describe('lateGroupRows', () => {
  const warnings = [
    warning('a', { testPackageNo: 'TP2', lineNo: 'L9' }),
    warning('a', { testPackageNo: 'TP2', lineNo: 'L9', milestone: 'iw' }),
    warning('b', { testPackageNo: null, lineNo: 'L1', milestone: 'ih' }),
    warning('c', { testPackageNo: 'TP1', lineNo: 'L1', milestone: 'ih' }),
  ]

  it('groups by package with distinct spools and late milestones counted, the no-package row last', () => {
    const rows = lateGroupRows(warnings, 'package')
    expect(rows.map((r) => r.key)).toEqual(['TP1', 'TP2', ''])
    expect(rows[1]).toMatchObject({ key: 'TP2', spoolCount: 1, counts: { ph: 1, ih: 0, iw: 1 } })
    expect(rows[1].warnings).toHaveLength(2)
    expect(rows[2]).toMatchObject({ spoolCount: 1, counts: { ph: 0, ih: 1, iw: 0 } })
  })

  it('groups by line', () => {
    const rows = lateGroupRows(warnings, 'line')
    expect(rows.map((r) => [r.key, r.spoolCount])).toEqual([['L1', 2], ['L9', 1]])
    expect(rows[0].counts).toEqual({ ph: 0, ih: 2, iw: 0 })
  })

  it('is empty without warnings', () => {
    expect(lateGroupRows([], 'line')).toEqual([])
  })
})

describe('lateWarningMatches', () => {
  const w = warning('a', { spoolNo: 'SP-Đường-01', lineNo: 'L-Ống 9', testPackageNo: 'TP-07' })

  it('matches SpoolNo, LineNo or Test Package No, case- and accent-blind, anywhere in the value', () => {
    expect(lateWarningMatches(w, 'duong')).toBe(true)
    expect(lateWarningMatches(w, 'ONG 9')).toBe(true)
    expect(lateWarningMatches(w, 'p-07')).toBe(true)
    expect(lateWarningMatches(w, 'TP-08')).toBe(false)
  })

  it('matches everything on an empty or blank search', () => {
    expect(lateWarningMatches(w, '')).toBe(true)
    expect(lateWarningMatches(w, '   ')).toBe(true)
  })

  it('never matches a missing LineNo or Test Package No', () => {
    expect(lateWarningMatches(warning('b', { spoolNo: 'X', lineNo: null, testPackageNo: null }), 'L')).toBe(false)
  })
})

describe('lateGroupRows with a search', () => {
  const warnings = [
    warning('a', { spoolNo: 'SP-A', testPackageNo: 'TP2', lineNo: 'L9' }),
    warning('a', { spoolNo: 'SP-A', testPackageNo: 'TP2', lineNo: 'L9', milestone: 'iw' }),
    warning('b', { spoolNo: 'SP-B', testPackageNo: 'TP2', lineNo: 'L1', milestone: 'ih' }),
    warning('c', { spoolNo: 'SP-C', testPackageNo: 'TP1', lineNo: 'L1' }),
  ]

  it('keeps a group whose key matches with all its spools', () => {
    const rows = lateGroupRows(warnings, 'package', 'tp2')
    expect(rows.map((r) => r.key)).toEqual(['TP2'])
    expect(rows[0]).toMatchObject({ spoolCount: 2, counts: { ph: 1, ih: 1, iw: 1 } })
  })

  it('keeps any other group with only its matching spools, recounted', () => {
    const rows = lateGroupRows(warnings, 'line', 'sp-b')
    expect(rows.map((r) => r.key)).toEqual(['L1'])
    expect(rows[0]).toMatchObject({ spoolCount: 1, counts: { ph: 0, ih: 1, iw: 0 } })
    expect(rows[0].warnings.map((w) => w.spoolId)).toEqual(['b'])
  })

  it('matches a spool by its other level\'s key too', () => {
    expect(lateGroupRows(warnings, 'package', 'L9').map((r) => [r.key, r.spoolCount])).toEqual([['TP2', 1]])
  })

  it('drops every group when nothing matches', () => {
    expect(lateGroupRows(warnings, 'package', 'zzz')).toEqual([])
  })
})

describe('lateSpoolRows', () => {
  const warnings = [
    warning('b', { spoolNo: 'SP-B', testPackageNo: null, lineNo: 'L1', milestone: 'ih' }),
    warning('a', { spoolNo: 'SP-A', testPackageNo: 'TP2', lineNo: 'L9' }),
    warning('a', { spoolNo: 'SP-A', testPackageNo: 'TP2', lineNo: 'L9', milestone: 'iw', daysLate: 4 }),
  ]

  it('gives one row per late spool, in the warnings\' spool order, with its late milestones', () => {
    const rows = lateSpoolRows(warnings)
    expect(rows.map((r) => [r.spoolId, r.spoolNo, r.lineNo, r.testPackageNo])).toEqual([
      ['b', 'SP-B', 'L1', null],
      ['a', 'SP-A', 'L9', 'TP2'],
    ])
    expect(Object.keys(rows[0].late)).toEqual(['ih'])
    expect(rows[1].late.ph).toBe(warnings[1])
    expect(rows[1].late.iw).toBe(warnings[2])
    expect(rows[1].late.ih).toBeUndefined()
  })

  it('keeps only the spools matching the search', () => {
    expect(lateSpoolRows(warnings, 'tp2').map((r) => r.spoolId)).toEqual(['a'])
    expect(lateSpoolRows(warnings, 'sp-b').map((r) => r.spoolId)).toEqual(['b'])
    expect(lateSpoolRows(warnings, 'nope')).toEqual([])
  })

  it('is empty without warnings', () => {
    expect(lateSpoolRows([])).toEqual([])
  })
})
