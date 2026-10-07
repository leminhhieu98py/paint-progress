import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builder } from '../../test/supabaseBuilder'
import { NO_PERMISSION, NOT_SAVED, PIPING_PAGE, TOO_MANY_ROWS } from './shared'
import {
  addManpowerGroup, deleteManpowerGroup, listManpowerActual, listManpowerGroups, listManpowerPlan,
  renameManpowerGroup, reorderManpowerGroups, replaceManpowerPlan, setManpowerActual, setManpowerGroupHidden,
} from './manpower'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
})

const UNIQUE = { code: '23505', message: 'duplicate key value violates unique constraint "piping_manpower_groups_name_key"' }

describe('groups', () => {
  it('lists groups by sort, hidden ones included', async () => {
    const b = builder({ data: [{ id: 'g1', name: 'Marking', sort: 3, hidden: true }] })
    from.mockReturnValue(b)
    expect(await listManpowerGroups('p1')).toEqual([{ id: 'g1', name: 'Marking', sort: 3, hidden: true }])
    expect(from).toHaveBeenCalledWith('piping_manpower_groups')
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.order.mock.calls.map((c) => c[0])).toEqual(['sort', 'id'])
  })

  it('adds a trimmed group and returns it', async () => {
    const b = builder({ data: { id: 'g9', name: 'Scaffold', sort: 4, hidden: false } })
    from.mockReturnValue(b)
    expect(await addManpowerGroup('p1', '  Scaffold ', 4)).toEqual({ id: 'g9', name: 'Scaffold', sort: 4, hidden: false })
    expect(b.insert).toHaveBeenCalledWith({ project_id: 'p1', name: 'Scaffold', sort: 4 })
    expect(b.single).toHaveBeenCalled()
  })

  it('refuses a blank name before writing', async () => {
    await expect(addManpowerGroup('p1', '   ', 1)).rejects.toThrow('Tên nhóm không được để trống')
    await expect(renameManpowerGroup('g1', '')).rejects.toThrow('Tên nhóm không được để trống')
    expect(from).not.toHaveBeenCalled()
  })

  it('names a duplicate in Vietnamese', async () => {
    from.mockReturnValue(builder({ error: UNIQUE }))
    await expect(addManpowerGroup('p1', 'marking', 4)).rejects.toThrow('Nhóm "marking" đã có trong dự án')
    from.mockReturnValue(builder({ error: UNIQUE }))
    await expect(renameManpowerGroup('g1', 'Marking')).rejects.toThrow('Nhóm "Marking" đã có trong dự án')
  })

  it('maps an RLS refusal of the insert', async () => {
    from.mockReturnValue(builder({ error: { code: '42501', message: 'new row violates row-level security policy for table "piping_manpower_groups"' } }))
    await expect(addManpowerGroup('p1', 'X', 1)).rejects.toThrow(NO_PERMISSION)
  })

  it('renames and hides one group, reporting a swallowed write', async () => {
    const r = builder({ data: [{ id: 'g1' }] })
    from.mockReturnValueOnce(r)
    await renameManpowerGroup('g1', ' Insulation 2 ')
    expect(r.update).toHaveBeenCalledWith({ name: 'Insulation 2' })
    expect(r.eq).toHaveBeenCalledWith('id', 'g1')

    const h = builder({ data: [{ id: 'g1' }] })
    from.mockReturnValueOnce(h)
    await setManpowerGroupHidden('g1', true)
    expect(h.update).toHaveBeenCalledWith({ hidden: true })

    from.mockReturnValueOnce(builder({ data: [] }))
    await expect(setManpowerGroupHidden('g1', false)).rejects.toThrow(NOT_SAVED)
  })

  it('reorders as sort 1..n', async () => {
    const bs = [builder({ data: [{ id: 'g2' }] }), builder({ data: [{ id: 'g1' }] })]
    from.mockReturnValueOnce(bs[0]).mockReturnValueOnce(bs[1])
    await reorderManpowerGroups(['g2', 'g1'])
    expect(bs[0].update).toHaveBeenCalledWith({ sort: 1 })
    expect(bs[0].eq).toHaveBeenCalledWith('id', 'g2')
    expect(bs[1].update).toHaveBeenCalledWith({ sort: 2 })
  })

  it("deletes an unused group and passes the guard's message through", async () => {
    const b = builder({ data: [{ id: 'g1' }] })
    from.mockReturnValueOnce(b)
    await deleteManpowerGroup('g1')
    expect(b.delete).toHaveBeenCalled()
    const message = 'Nhóm "Marking" đã có dữ liệu, không xoá được -- hãy ẩn nhóm'
    from.mockReturnValueOnce(builder({ error: { code: 'P0001', message } }))
    await expect(deleteManpowerGroup('g1')).rejects.toThrow(message)
  })
})

describe('plan', () => {
  it('lists the plan with numbers, ordered by the primary key', async () => {
    const b = builder({ data: [{ group_id: 'g1', day: '2026-09-07', value: '6' }] })
    from.mockReturnValue(b)
    expect(await listManpowerPlan('p1')).toEqual([{ groupId: 'g1', day: '2026-09-07', value: 6 }])
    expect(from).toHaveBeenCalledWith('piping_manpower_plan')
    expect(b.order.mock.calls.map((c) => c[0])).toEqual(['day', 'group_id'])
  })

  it('pages past 1000 rows', async () => {
    const full = Array.from({ length: PIPING_PAGE }, () => ({ group_id: 'g1', day: '2026-09-07', value: '1' }))
    from.mockReturnValueOnce(builder({ data: full })).mockReturnValueOnce(builder({ data: [] }))
    expect(await listManpowerPlan('p1')).toHaveLength(PIPING_PAGE)
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('replaces with snake_case cells', async () => {
    rpc.mockResolvedValue({ data: { rows: 1, cells: 2, added: 2, changed: 0, removed: 0, log_id: 'l2' }, error: null })
    const result = await replaceManpowerPlan('p1', [
      { groupId: 'g1', day: '2026-09-07', value: 6 },
      { groupId: 'g2', day: '2026-09-07', value: 0 },
    ], 'mp.xlsx')
    expect(rpc).toHaveBeenCalledWith('piping_replace_manpower_plan', {
      p_project: 'p1',
      p_rows: [{ group_id: 'g1', day: '2026-09-07', value: 6 }, { group_id: 'g2', day: '2026-09-07', value: 0 }],
      p_file_name: 'mp.xlsx',
      p_summary: {},
    })
    expect(result.logId).toBe('l2')
    expect(result.summary).toEqual({ rows: 1, cells: 2, added: 2, changed: 0, removed: 0 })
  })

  it('counts the limit in days, not cells', async () => {
    rpc.mockResolvedValue({ data: { log_id: 'l' }, error: null })
    const sameDays = Array.from({ length: 30_000 }, (_, i) => ({ groupId: `g${i % 3}`, day: `d${Math.floor(i / 3)}`, value: 1 }))
    await replaceManpowerPlan('p1', sameDays, 'f')
    const tooMany = Array.from({ length: 20_001 }, (_, i) => ({ groupId: 'g1', day: `d${i}`, value: 1 }))
    rpc.mockClear()
    await expect(replaceManpowerPlan('p1', tooMany, 'f')).rejects.toThrow(TOO_MANY_ROWS)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('actual', () => {
  it('lists cells with stamps and names', async () => {
    const b = builder({
      data: [{
        group_id: 'g1', day: '2026-09-07', value: '4.5', created_by: 'u1', created_at: 't1',
        edited_by: 'u2', edited_at: 't2', creator: { full_name: 'Lan' }, editor: { full_name: 'Admin' },
      }],
    })
    from.mockReturnValue(b)
    expect(await listManpowerActual('p1')).toEqual([{
      groupId: 'g1', day: '2026-09-07', value: 4.5, createdBy: 'u1', createdAt: 't1', editedBy: 'u2', editedAt: 't2',
      createdByName: 'Lan', editedByName: 'Admin',
    }])
    expect(String(b.select.mock.calls[0][0])).toContain('profiles!piping_manpower_actual_edited_by_fkey')
  })

  it('sets a day through the function, nulls included, and returns the count', async () => {
    rpc.mockResolvedValue({ data: 2, error: null })
    expect(await setManpowerActual('p1', '2026-09-07', [{ groupId: 'g1', value: 3 }, { groupId: 'g2', value: null }])).toBe(2)
    expect(rpc).toHaveBeenCalledWith('piping_set_manpower_actual', {
      p_project: 'p1', p_day: '2026-09-07', p_values: [{ group_id: 'g1', value: 3 }, { group_id: 'g2', value: null }],
    })
  })

  it('refuses a negative value or a missing day before calling', async () => {
    await expect(setManpowerActual('p1', '2026-09-07', [{ groupId: 'g1', value: -1 }])).rejects.toThrow(/lớn hơn hoặc bằng 0/)
    await expect(setManpowerActual('p1', '', [])).rejects.toThrow('Thiếu ngày')
    expect(rpc).not.toHaveBeenCalled()
  })

  it("keeps the GS fill-empty-only message", async () => {
    const message = 'Nhóm "Marking" ngày 07/09/2026 đã có giá trị (4); chỉ admin được sửa'
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } })
    await expect(setManpowerActual('p1', '2026-09-07', [{ groupId: 'g1', value: 5 }])).rejects.toThrow(message)
  })
})
