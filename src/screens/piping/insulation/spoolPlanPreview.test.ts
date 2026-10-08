import { describe, expect, it } from 'vitest'
import type { SpoolPlanRow } from '../../../domain/piping/imports'
import type { Spool } from '../../../domain/piping/types'
import { spoolPlanPreview, spoolPlanSummary } from './spoolPlanPreview'

const spool = (seq: number, over: Partial<Spool> = {}): Spool => ({
  id: `s${seq}`, seq, spoolNo: `SP-${seq}`, lineNo: 'L1', insuType: null, drawingNo: null, testPackageNo: 'TP1',
  paintingSystem: null, extra: {}, phPlan: '2026-10-01', ihPlan: null, iwPlan: null, phActual: null, ihActual: null,
  iwActual: null, ...over,
})
const row = (seq: number, over: Partial<SpoolPlanRow> = {}): SpoolPlanRow => ({
  row: seq + 1, seq, spoolNo: `SP-${seq}`, lineNo: 'L1', insuType: null, drawingNo: null, testPackageNo: 'TP1',
  paintingSystem: null, extra: {}, phPlan: '2026-10-01', ihPlan: null, iwPlan: null, ...over,
})

describe('spoolPlanPreview (spec §6.2)', () => {
  const stored = [
    spool(1),
    spool(2, { phActual: '2026-10-02' }),
    spool(3),
    spool(4, { extra: { Zone: 'A' } }),
  ]
  const next = [
    row(1),
    row(4, { phPlan: '2026-10-09', extra: { Zone: 'B' } }),
    row(5, { spoolNo: 'SP-9' }),
  ]

  it('lists added, changed (each field, old -> new) and removed spools, flagging those with actuals', () => {
    const p = spoolPlanPreview(stored, next)
    expect(p).toMatchObject({ added: 1, changed: 1, removed: 2, unchanged: 1 })
    expect(p.lines.map((l) => [l.change, l.label, l.from, l.to, l.flag ?? null])).toEqual([
      ['added', 'SP-9', null, 'Dòng 6', null],
      ['changed', 'SP-4 · Painting Handover – Plan', '01/10/2026', '09/10/2026', null],
      ['changed', 'SP-4 · Zone', 'A', 'B', null],
      ['removed', 'SP-2', 'L1 · TP1', null, 'có Actual'],
      ['removed', 'SP-3', 'L1 · TP1', null, null],
    ])
  })

  it('says in a danger tone that the removed spools with actuals lose them', () => {
    const p = spoolPlanPreview(stored, next)
    expect(p.dangers).toEqual(['1 spool bị xoá cùng ngày Actual đã nhập: SP-2.'])
    expect(p.consequences).toEqual([
      '2 spool không có trong file bị xoá.',
      'Spool khớp SpoolNo giữ nguyên ngày Actual.',
    ])
  })

  it('has no danger when no removed spool carries an actual', () => {
    expect(spoolPlanPreview([spool(1)], [row(1)]).dangers).toEqual([])
  })

  it('summarises the diff for the import log', () => {
    expect(spoolPlanSummary(stored, next)).toEqual({ added: 1, changed: 1, removed: 2, removedWithActuals: 1 })
  })
})
