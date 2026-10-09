import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builder } from '../../test/supabaseBuilder'
import { NO_PERMISSION, NOT_SAVED, PIPING_PAGE, TOO_MANY_ROWS } from './shared'
import {
  addReinstatementEntry, deleteReinstatementEntry, listReinstatementEntries, listReinstatementPlan,
  replaceReinstatementPlan, updateReinstatementEntry,
} from './reinstatement'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
})

describe('listReinstatementPlan', () => {
  it('maps numerics (number or string) and orders by day', async () => {
    const b = builder({ data: [{ day: '2026-09-07', plan_qty: 12.5 }, { day: '2026-09-08', plan_qty: '0' }] })
    from.mockReturnValue(b)
    expect(await listReinstatementPlan('p1')).toEqual([
      { day: '2026-09-07', planQty: 12.5 },
      { day: '2026-09-08', planQty: 0 },
    ])
    expect(from).toHaveBeenCalledWith('piping_reinstatement_plan')
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.order).toHaveBeenCalledWith('day', { ascending: true })
    expect(b.range).toHaveBeenCalledWith(0, PIPING_PAGE - 1)
  })

  it('pages past 1000 rows', async () => {
    const full = Array.from({ length: PIPING_PAGE }, () => ({ day: '2026-09-07', plan_qty: '1' }))
    const second = builder({ data: [{ day: '2026-09-08', plan_qty: '2' }] })
    from.mockReturnValueOnce(builder({ data: full })).mockReturnValueOnce(second)
    expect(await listReinstatementPlan('p1')).toHaveLength(PIPING_PAGE + 1)
    expect(second.range).toHaveBeenCalledWith(PIPING_PAGE, 2 * PIPING_PAGE - 1)
  })
})

describe('replaceReinstatementPlan', () => {
  it('sends snake_case rows, the file name and the summary, and splits off log_id', async () => {
    rpc.mockResolvedValue({ data: { note: 'x', rows: 1, added: 1, changed: 0, removed: 0, log_id: 'l1' }, error: null })
    const result = await replaceReinstatementPlan('p1', [{ day: '2026-09-07', planQty: 3 }], 'plan.xlsx', { note: 'x' })
    expect(rpc).toHaveBeenCalledWith('piping_replace_reinstatement_plan', {
      p_project: 'p1', p_rows: [{ day: '2026-09-07', plan_qty: 3 }], p_file_name: 'plan.xlsx', p_summary: { note: 'x' },
    })
    expect(result).toEqual({ logId: 'l1', summary: { note: 'x', rows: 1, added: 1, changed: 0, removed: 0 } })
  })

  it('defaults the summary to an empty object', async () => {
    rpc.mockResolvedValue({ data: { log_id: 'l1' }, error: null })
    await replaceReinstatementPlan('p1', [], 'f.xlsx')
    expect(rpc.mock.calls[0][1]).toHaveProperty('p_summary', {})
  })

  it('refuses more than 20 000 rows without calling', async () => {
    const rows = Array.from({ length: 20_001 }, () => ({ day: '2026-09-07', planQty: 1 }))
    await expect(replaceReinstatementPlan('p1', rows, 'f.xlsx')).rejects.toThrow(TOO_MANY_ROWS)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("keeps the function's message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Ngày 07/09/2026 lặp lại trong file' } })
    await expect(replaceReinstatementPlan('p1', [], 'f')).rejects.toThrow('Ngày 07/09/2026 lặp lại trong file')
  })
})

describe('listReinstatementEntries', () => {
  it('maps entries with stamps and embedded names, ordered totally', async () => {
    const b = builder({
      data: [{
        id: 'e1', day: '2026-09-07', qty: '5', created_by: 'u1', created_at: '2026-09-07T03:00:00Z',
        edited_by: null, edited_at: null, creator: { full_name: 'Lan' }, editor: null,
      }],
    })
    from.mockReturnValue(b)
    expect(await listReinstatementEntries('p1')).toEqual([{
      id: 'e1', day: '2026-09-07', qty: 5, createdBy: 'u1', createdAt: '2026-09-07T03:00:00Z',
      editedBy: null, editedAt: null, createdByName: 'Lan', editedByName: null,
    }])
    expect(from).toHaveBeenCalledWith('piping_reinstatement_actual')
    expect(String(b.select.mock.calls[0][0])).toContain('profiles!piping_reinstatement_actual_created_by_fkey')
    expect(b.order.mock.calls.map((c) => c[0])).toEqual(['day', 'created_at', 'id'])
  })
})

describe('addReinstatementEntry', () => {
  it('calls piping_add_reinstatement and returns the new id', async () => {
    rpc.mockResolvedValue({ data: 'e9', error: null })
    expect(await addReinstatementEntry('p1', '2026-09-07', 4)).toBe('e9')
    expect(rpc).toHaveBeenCalledWith('piping_add_reinstatement', { p_project: 'p1', p_day: '2026-09-07', p_qty: 4 })
  })

  it.each([0, -1, Number.NaN])('refuses qty %s before calling', async (qty) => {
    await expect(addReinstatementEntry('p1', '2026-09-07', qty)).rejects.toThrow('Số lượng phải lớn hơn 0')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a missing or impossible day', async () => {
    await expect(addReinstatementEntry('p1', '', 1)).rejects.toThrow('Thiếu ngày')
    await expect(addReinstatementEntry('p1', '2026-02-30', 1)).rejects.toThrow('Thiếu ngày')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('shows the cap message as the function words it', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Vượt tổng Test Pack (đã có 1020 / 1022)' } })
    await expect(addReinstatementEntry('p1', '2026-09-07', 5)).rejects.toThrow('Vượt tổng Test Pack (đã có 1020 / 1022)')
  })
})

describe('updateReinstatementEntry / deleteReinstatementEntry', () => {
  it('updates day and qty of the one entry', async () => {
    const b = builder({ data: [{ id: 'e1' }] })
    from.mockReturnValue(b)
    await updateReinstatementEntry('e1', { day: '2026-09-08', qty: 2 })
    expect(b.update).toHaveBeenCalledWith({ day: '2026-09-08', qty: 2 })
    expect(b.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('refuses qty 0 before writing', async () => {
    await expect(updateReinstatementEntry('e1', { day: '2026-09-08', qty: 0 })).rejects.toThrow('Số lượng phải lớn hơn 0')
    expect(from).not.toHaveBeenCalled()
  })

  it("passes the trigger's Vietnamese message through", async () => {
    from.mockReturnValue(builder({ error: { code: 'P0001', message: 'Không nhập được ngày trong tương lai (09/10/2026)' } }))
    await expect(updateReinstatementEntry('e1', { day: '2026-10-09', qty: 1 }))
      .rejects.toThrow('Không nhập được ngày trong tương lai (09/10/2026)')
  })

  it('reports an update RLS swallowed', async () => {
    from.mockReturnValue(builder({ data: [] }))
    await expect(updateReinstatementEntry('e1', { day: '2026-09-08', qty: 2 })).rejects.toThrow(NOT_SAVED)
  })

  it('deletes the one entry', async () => {
    const b = builder({ data: [{ id: 'e1' }] })
    from.mockReturnValue(b)
    await deleteReinstatementEntry('e1')
    expect(b.delete).toHaveBeenCalled()
    expect(b.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('reports a delete that matched nothing, and maps 42501', async () => {
    from.mockReturnValueOnce(builder({ data: [] }))
    await expect(deleteReinstatementEntry('e1')).rejects.toThrow(NOT_SAVED)
    from.mockReturnValueOnce(builder({ error: { code: '42501', message: 'permission denied for table piping_reinstatement_actual' } }))
    await expect(deleteReinstatementEntry('e1')).rejects.toThrow(NO_PERMISSION)
  })
})
