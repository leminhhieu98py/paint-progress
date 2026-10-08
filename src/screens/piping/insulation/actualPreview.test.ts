import { describe, expect, it } from 'vitest'
import type { ActualChange } from '../../../domain/piping/cam'
import type { Spool } from '../../../domain/piping/types'
import type { SpoolActualResult } from '../../../lib/pipingApi'
import { actualPreview, changesToWrite, setMilestones, targetSpools, targetValues } from './actualPreview'

const spool = (seq: number, over: Partial<Spool> = {}): Spool => ({
  id: `s${seq}`, seq, spoolNo: `SP-${seq}`, lineNo: 'L1', insuType: null, drawingNo: null, testPackageNo: 'TP1',
  paintingSystem: null, extra: {}, phPlan: null, ihPlan: null, iwPlan: null, phActual: null, ihActual: null,
  iwActual: null, ...over,
})

describe('targetValues / targetSpools', () => {
  const spools = [
    spool(1, { spoolNo: ' SP-10 ', lineNo: 'L2', testPackageNo: 'TP10' }),
    spool(2, { spoolNo: 'SP-2', lineNo: ' L1 ', testPackageNo: 'TP2' }),
    spool(3, { spoolNo: 'SP-10', lineNo: null, testPackageNo: '  ' }),
  ]

  it('offers the distinct non-blank values of the chosen field, trimmed, in text order', () => {
    expect(targetValues(spools, 'spool')).toEqual(['SP-2', 'SP-10'])
    expect(targetValues(spools, 'line')).toEqual(['L1', 'L2'])
    expect(targetValues(spools, 'package')).toEqual(['TP2', 'TP10'])
  })

  it('matches every spool carrying the value (one SpoolNo -> all its spools)', () => {
    expect(targetSpools(spools, 'spool', 'SP-10').map((s) => s.id)).toEqual(['s1', 's3'])
    expect(targetSpools(spools, 'line', 'L1').map((s) => s.id)).toEqual(['s2'])
    expect(targetSpools(spools, 'package', 'TP10').map((s) => s.id)).toEqual(['s1'])
  })
})

describe('actualPreview', () => {
  const spools = [
    spool(1),
    spool(2, { phActual: '2026-10-01' }),
    spool(3, { ihActual: '2026-10-02' }),
    spool(4, { phActual: '2026-10-05' }),
  ]
  const changes: ActualChange[] = spools.map((s) => ({ spoolId: s.id, milestone: 'ph', date: '2026-10-05' }))
  const results: SpoolActualResult[] = [
    { spoolId: 's1', spoolNo: 'SP-1', status: 'saved' },
    { spoolId: 's2', spoolNo: 'SP-2', status: 'overwrite_needed' },
    { spoolId: 's3', spoolNo: 'SP-3', status: 'order' },
    { spoolId: 's4', spoolNo: 'SP-4', status: 'unchanged' },
    { spoolId: 'gone', spoolNo: null, status: 'not_found' },
  ]

  it('sorts the dry run statuses into saved, overwritten (old -> new), skipped with a reason, unchanged', () => {
    const p = actualPreview(spools, changes, results)
    expect(p.save).toBe(1)
    expect(p.overwriteSpools).toBe(1)
    expect(p.overwrites).toEqual([
      expect.objectContaining({ spoolNo: 'SP-2', milestone: 'ph', from: '2026-10-01', to: '2026-10-05' }),
    ])
    expect(p.unchanged).toBe(1)
    expect(p.skipped).toEqual([
      expect.objectContaining({
        spoolNo: 'SP-3',
        reason: 'Sai thứ tự: Painting Handover (05/10/2026) sau Insulation Handover (02/10/2026)',
      }),
      expect.objectContaining({ spoolNo: '-', reason: 'Không tìm thấy spool' }),
    ])
  })

  it('writes the saved spools, and the overwritten ones only when confirmed', () => {
    expect(changesToWrite(changes, results, false).map((c) => c.spoolId)).toEqual(['s1'])
    expect(changesToWrite(changes, results, true).map((c) => c.spoolId)).toEqual(['s1', 's2'])
  })
})

describe('setMilestones', () => {
  it('lists the milestones holding an actual date, PH, IH, IW order', () => {
    expect(setMilestones(spool(1))).toEqual([])
    expect(setMilestones(spool(2, { iwActual: '2026-10-03', phActual: '2026-10-01' }))).toEqual(['ph', 'iw'])
  })
})
