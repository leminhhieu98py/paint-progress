import { describe, expect, it } from 'vitest'
import { camProgress } from './cam'
import { columnUnit, resolveUnit, unitLabel, unitOptions } from './camUnit'
import type { Spool, SpoolColumn } from './types'

const spool = (seq: number, extra: Record<string, string>, over: Partial<Spool> = {}): Spool => ({
  id: `s${seq}`, seq, spoolNo: `SP-${seq}`, lineNo: 'L1', insuType: null, drawingNo: null, testPackageNo: null,
  paintingSystem: null, extra, phPlan: null, ihPlan: null, iwPlan: null, phActual: null, ihActual: null,
  iwActual: null, ...over,
})

const COLUMNS: SpoolColumn[] = [
  { id: 'c2', label: 'Length (mm)', sort: 2, kind: 'number' },
  { id: 'c1', label: 'Area (m2)', sort: 1, kind: 'number' },
  { id: 'c3', label: 'Zone', sort: 3, kind: 'text' },
]

describe('resolveUnit (RV9-1)', () => {
  it('keeps the six built-ins: SpoolNo by rows, the others by distinct values', () => {
    const s = spool(1, {}, { lineNo: 'L9' })
    expect(resolveUnit('spoolNo', COLUMNS)).toEqual({ unit: 'spoolNo', label: 'SpoolNo', count: { kind: 'rows' } })
    const line = resolveUnit('lineNo', COLUMNS)
    expect([line.unit, line.label, line.count.kind]).toEqual(['lineNo', 'LineNo', 'distinct'])
    expect(line.count.kind === 'distinct' && line.count.value(s)).toBe('L9')
    expect(resolveUnit('testPackageNo', []).label).toBe('Test Package No')
  })

  it('counts a text column by its distinct non-blank values, labelled as configured', () => {
    const zone = resolveUnit(columnUnit(COLUMNS[2]), COLUMNS)
    expect([zone.unit, zone.label, zone.count.kind]).toEqual(['col:c3', 'Zone', 'distinct'])
    const spools = [
      spool(1, { Zone: 'Z1' }, { phActual: '2026-10-01' }),
      spool(2, { Zone: 'Z1' }),
      spool(3, { Zone: ' ' }),
      spool(4, {}),
      spool(5, { Zone: 'Z2' }, { phActual: '2026-10-02' }),
    ]
    expect(camProgress(spools, zone.count)).toEqual({ total: 2, done: { ph: 1, ih: 0, iw: 0 } })
  })

  it('sums a number column, reading a plain decimal and a vi number; blank or not a number is 0', () => {
    const area = resolveUnit('col:c1', COLUMNS)
    expect([area.unit, area.label, area.count.kind]).toEqual(['col:c1', 'Area (m2)', 'sum'])
    const value = (extra: Record<string, string>) => (area.count.kind === 'sum' ? area.count.value(spool(1, extra)) : NaN)
    expect(value({ 'Area (m2)': '1234.5' })).toBe(1234.5)
    expect(value({ 'Area (m2)': '1.234,5' })).toBe(1234.5)
    expect(value({ 'Area (m2)': ' 12,5 ' })).toBe(12.5)
    expect(value({ 'Area (m2)': '' })).toBe(0)
    expect(value({ 'Area (m2)': 'n/a' })).toBe(0)
    expect(value({})).toBe(0)
    const spools = [
      spool(1, { 'Area (m2)': '12.5' }, { phActual: '2026-10-01' }),
      spool(2, { 'Area (m2)': '27.5' }),
      spool(3, {}),
    ]
    expect(camProgress(spools, area.count)).toEqual({ total: 40, done: { ph: 12.5, ih: 0, iw: 0 } })
  })

  it('falls back to SpoolNo for a column that is no longer configured', () => {
    expect(resolveUnit('col:gone', COLUMNS)).toEqual({ unit: 'spoolNo', label: 'SpoolNo', count: { kind: 'rows' } })
    expect(unitLabel('col:gone', COLUMNS)).toBe('SpoolNo')
  })

  it('labels a unit as the selector does', () => {
    expect(unitLabel('paintingSystem', COLUMNS)).toBe('Painting System')
    expect(unitLabel('col:c2', COLUMNS)).toBe('Length (mm)')
  })
})

describe('unitOptions (RV9-1)', () => {
  it('lists the six built-ins, then the extra columns in their configured order', () => {
    expect(unitOptions(COLUMNS)).toEqual([
      { value: 'spoolNo', label: 'SpoolNo' },
      { value: 'lineNo', label: 'LineNo' },
      { value: 'insuType', label: 'InsuType' },
      { value: 'drawingNo', label: 'DrawingNo' },
      { value: 'testPackageNo', label: 'Test Package No' },
      { value: 'paintingSystem', label: 'Painting System' },
      { value: 'col:c1', label: 'Area (m2)' },
      { value: 'col:c2', label: 'Length (mm)' },
      { value: 'col:c3', label: 'Zone' },
    ])
  })
})
