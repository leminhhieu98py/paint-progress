import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builder } from '../../test/supabaseBuilder'
import { PIPING_PAGE, TOO_MANY_ROWS } from './shared'
import { flattenActualUpdates, listSpools, replaceSpools, setSpoolActuals } from './spools'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
})

const ROW = {
  id: 's1', seq: 1, spool_no: 'SP-01', line_no: 'L1', insu_type: 'Hot', drawing_no: null, test_package_no: 'TP1',
  painting_system: 'PS1', extra: { Zone: 'A', Bad: 3 },
  ph_plan: '2026-09-01', ih_plan: null, iw_plan: '2026-09-20',
  ph_actual: '2026-09-02', ih_actual: null, iw_actual: null,
  ph_actual_by: 'u1', ph_actual_at: '2026-09-02T01:00:00Z', ih_actual_by: null, ih_actual_at: null,
  iw_actual_by: null, iw_actual_at: null,
}

describe('listSpools', () => {
  it('maps a row to the domain spool, stamps and text-only extra included', async () => {
    const b = builder({ data: [ROW] })
    from.mockReturnValue(b)
    expect(await listSpools('p1')).toEqual([{
      id: 's1', seq: 1, spoolNo: 'SP-01', lineNo: 'L1', insuType: 'Hot', drawingNo: null, testPackageNo: 'TP1',
      paintingSystem: 'PS1', extra: { Zone: 'A' },
      phPlan: '2026-09-01', ihPlan: null, iwPlan: '2026-09-20',
      phActual: '2026-09-02', ihActual: null, iwActual: null,
      stamps: {
        ph: { by: 'u1', at: '2026-09-02T01:00:00Z' }, ih: { by: null, at: null }, iw: { by: null, at: null },
      },
    }])
    expect(from).toHaveBeenCalledWith('piping_spools')
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.order.mock.calls.map((c) => c[0])).toEqual(['seq', 'id'])
  })

  it('pages through 20 000 spools in 1000-row ranges', async () => {
    const full = Array.from({ length: PIPING_PAGE }, (_, i) => ({ ...ROW, id: `s${i}` }))
    const pages = Array.from({ length: 20 }, () => builder({ data: full }))
    const last = builder({ data: [] })
    for (const p of pages) from.mockReturnValueOnce(p)
    from.mockReturnValueOnce(last)
    expect(await listSpools('p1')).toHaveLength(20_000)
    expect(from).toHaveBeenCalledTimes(21)
    expect(pages[19].range).toHaveBeenCalledWith(19_000, 19_999)
    expect(last.range).toHaveBeenCalledWith(20_000, 20_999)
  })

  it('reads an empty extra and a null one as {}', async () => {
    from.mockReturnValue(builder({ data: [{ ...ROW, extra: null }] }))
    expect((await listSpools('p1'))[0].extra).toEqual({})
  })
})

describe('replaceSpools', () => {
  const INPUT = {
    spoolNo: 'SP-01', lineNo: 'L1', insuType: null, drawingNo: 'D1', testPackageNo: 'TP1', paintingSystem: null,
    phPlan: '2026-09-01', ihPlan: null, iwPlan: null, extra: { Zone: 'A' },
  }

  it('sends the rows in order, snake_case, and returns the log', async () => {
    rpc.mockResolvedValue({ data: { rows: 1, added: 1, matched: 0, changed: 0, removed: 0, removed_with_actuals: 0, log_id: 'l3' }, error: null })
    const result = await replaceSpools('p1', [INPUT, { ...INPUT, spoolNo: 'SP-02' }], 'cam.xlsx', { duplicates: 0 })
    expect(rpc).toHaveBeenCalledWith('piping_replace_spools', {
      p_project: 'p1',
      p_rows: [
        {
          spool_no: 'SP-01', line_no: 'L1', insu_type: null, drawing_no: 'D1', test_package_no: 'TP1',
          painting_system: null, ph_plan: '2026-09-01', ih_plan: null, iw_plan: null, extra: { Zone: 'A' },
        },
        expect.objectContaining({ spool_no: 'SP-02' }),
      ],
      p_file_name: 'cam.xlsx',
      p_summary: { duplicates: 0 },
    })
    expect(result).toEqual({
      logId: 'l3', summary: { rows: 1, added: 1, matched: 0, changed: 0, removed: 0, removed_with_actuals: 0 },
    })
  })

  it('does not send a parse row number or seq', async () => {
    rpc.mockResolvedValue({ data: { log_id: 'l' }, error: null })
    await replaceSpools('p1', [{ ...INPUT, row: 7, seq: 3 } as typeof INPUT], 'f')
    const sent = rpc.mock.calls[0][1].p_rows[0]
    expect(sent).not.toHaveProperty('row')
    expect(sent).not.toHaveProperty('seq')
  })

  it('refuses more than 20 000 rows before calling', async () => {
    await expect(replaceSpools('p1', Array.from({ length: 20_001 }, () => INPUT), 'f')).rejects.toThrow(TOO_MANY_ROWS)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("keeps the function's row message", async () => {
    const message = 'Cột "Zone" ở dòng 4 chưa được cấu hình (Cấu hình → Cột thêm)'
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } })
    await expect(replaceSpools('p1', [INPUT], 'f')).rejects.toThrow(message)
  })
})

describe('setSpoolActuals', () => {
  const CHANGES = [
    { spoolId: 's1', milestone: 'ph' as const, date: '2026-09-02' },
    { spoolId: 's1', milestone: 'ih' as const, date: null },
  ]

  it('sends all six arguments with their defaults', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await setSpoolActuals('p1', CHANGES)
    expect(rpc).toHaveBeenCalledWith('piping_set_spool_actuals', {
      p_project: 'p1',
      p_changes: [
        { spool_id: 's1', milestone: 'ph', date: '2026-09-02' },
        { spool_id: 's1', milestone: 'ih', date: null },
      ],
      p_overwrite: false,
      p_import_file: null,
      p_dry_run: false,
      p_file_rows: null,
    })
  })

  it('passes overwrite, import file, dry run and file rows', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await setSpoolActuals('p1', CHANGES, { overwrite: true, importFile: 'actual.xlsx', dryRun: true, fileRows: 120 })
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_overwrite: true, p_import_file: 'actual.xlsx', p_dry_run: true, p_file_rows: 120,
    })
  })

  it('maps the per-spool result', async () => {
    rpc.mockResolvedValue({
      data: [
        { spool_id: 's1', spool_no: 'SP-01', status: 'saved' },
        { spool_id: 's2', spool_no: null, status: 'not_found' },
        { spool_id: 's3', spool_no: 'SP-03', status: 'overwrite_needed' },
      ],
      error: null,
    })
    expect(await setSpoolActuals('p1', CHANGES)).toEqual([
      { spoolId: 's1', spoolNo: 'SP-01', status: 'saved' },
      { spoolId: 's2', spoolNo: null, status: 'not_found' },
      { spoolId: 's3', spoolNo: 'SP-03', status: 'overwrite_needed' },
    ])
  })

  it('refuses more than 60 000 changes or 20 000 spools before calling', async () => {
    const many = Array.from({ length: 60_001 }, (_, i) => ({ spoolId: `s${i % 20_000}`, milestone: 'ph' as const, date: null }))
    await expect(setSpoolActuals('p1', many)).rejects.toThrow(TOO_MANY_ROWS)
    const spools = Array.from({ length: 20_001 }, (_, i) => ({ spoolId: `s${i}`, milestone: 'ph' as const, date: null }))
    await expect(setSpoolActuals('p1', spools)).rejects.toThrow(TOO_MANY_ROWS)
    await expect(setSpoolActuals('p1', CHANGES, { fileRows: 20_001 })).rejects.toThrow(TOO_MANY_ROWS)
    await expect(setSpoolActuals('p1', CHANGES, { fileRows: -1 })).rejects.toThrow(TOO_MANY_ROWS)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts exactly 60 000 changes over 20 000 spools', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const ms = ['ph', 'ih', 'iw'] as const
    const max = Array.from({ length: 60_000 }, (_, i) => ({ spoolId: `s${i % 20_000}`, milestone: ms[Math.floor(i / 20_000)], date: null }))
    await setSpoolActuals('p1', max, { fileRows: 20_000 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("keeps the import's all-or-nothing message and the GS clear refusal", async () => {
    const message = 'Spool SP-01: đã có ngày thực tế khác, cần xác nhận ghi đè. Không có dữ liệu nào được ghi.'
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message } })
    await expect(setSpoolActuals('p1', CHANGES, { importFile: 'a.xlsx' })).rejects.toThrow(message)
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Chỉ admin được xoá ngày thực tế' } })
    await expect(setSpoolActuals('p1', CHANGES)).rejects.toThrow('Chỉ admin được xoá ngày thực tế')
  })
})

describe('flattenActualUpdates', () => {
  it('turns per-spool updates into one change per milestone', () => {
    expect(flattenActualUpdates([
      { spoolId: 's1', spoolNo: 'A', changes: [{ milestone: 'ph', date: '2026-09-01' }, { milestone: 'iw', date: null }] },
      { spoolId: 's2', spoolNo: 'B', changes: [{ milestone: 'ih', date: '2026-09-03' }] },
    ])).toEqual([
      { spoolId: 's1', milestone: 'ph', date: '2026-09-01' },
      { spoolId: 's1', milestone: 'iw', date: null },
      { spoolId: 's2', milestone: 'ih', date: '2026-09-03' },
    ])
  })
})
