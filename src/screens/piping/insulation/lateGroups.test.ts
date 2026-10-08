import { describe, expect, it } from 'vitest'
import type { LateWarning } from '../../../domain/piping/cam'
import { lateFact, lateGroupRows, lateRule } from './lateGroups'

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
