import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builder } from '../../test/supabaseBuilder'
import { NOT_SAVED } from './shared'
import { addSpoolColumn, deleteSpoolColumn, listSpoolColumns, renameSpoolColumn, reorderSpoolColumns } from './spoolColumns'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
})

const COLUMNS = [{ id: 'c1', label: 'Zone', sort: 1 }, { id: 'c2', label: 'Area', sort: 2 }]

describe('CRUD', () => {
  it('lists by sort', async () => {
    const b = builder({ data: COLUMNS })
    from.mockReturnValue(b)
    expect(await listSpoolColumns('p1')).toEqual(COLUMNS)
    expect(from).toHaveBeenCalledWith('piping_spool_columns')
    expect(b.order.mock.calls.map((c) => c[0])).toEqual(['sort', 'id'])
  })

  it('adds a trimmed label, names a duplicate, refuses a blank one', async () => {
    const b = builder({ data: { id: 'c3', label: 'Module', sort: 3 } })
    from.mockReturnValueOnce(b)
    expect(await addSpoolColumn('p1', ' Module ', 3)).toEqual({ id: 'c3', label: 'Module', sort: 3 })
    expect(b.insert).toHaveBeenCalledWith({ project_id: 'p1', label: 'Module', sort: 3 })

    from.mockReturnValueOnce(builder({ error: { code: '23505', message: 'duplicate key' } }))
    await expect(addSpoolColumn('p1', 'zone', 3)).rejects.toThrow('Cột "zone" đã có trong dự án')

    await expect(addSpoolColumn('p1', ' ', 3)).rejects.toThrow('Tên cột không được để trống')
  })

  it('refuses a built-in header as a new label', async () => {
    await expect(addSpoolColumn('p1', 'SpoolNo', 3)).rejects.toThrow('Tên cột "SpoolNo" trùng tên cột chuẩn SpoolNo')
    expect(from).not.toHaveBeenCalled()
  })

  it('reorders through piping_reorder, atomically', async () => {
    rpc.mockResolvedValue({ data: 2, error: null })
    await reorderSpoolColumns('p1', ['c2', 'c1'])
    expect(rpc).toHaveBeenCalledWith('piping_reorder', { p_project: 'p1', p_kind: 'column', p_ids: ['c2', 'c1'] })
    expect(from).not.toHaveBeenCalled()
    const stale = 'Danh sách đã thay đổi, tải lại trang rồi sắp xếp lại'
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: stale } })
    await expect(reorderSpoolColumns('p1', ['c2'])).rejects.toThrow(stale)
  })

  it('deletes', async () => {
    const d = builder({ data: [{ id: 'c1' }] })
    from.mockReturnValueOnce(d)
    await deleteSpoolColumn('c1')
    expect(d.delete).toHaveBeenCalled()
    expect(d.eq).toHaveBeenCalledWith('id', 'c1')

    from.mockReturnValueOnce(builder({ data: [] }))
    await expect(deleteSpoolColumn('c1')).rejects.toThrow(NOT_SAVED)
  })
})

describe('renameSpoolColumn', () => {
  it('renames through the function with the trimmed label and returns the spool count', async () => {
    rpc.mockResolvedValue({ data: 42, error: null })
    expect(await renameSpoolColumn('p1', 'c1', ' Khu vực ')).toEqual({ spoolsUpdated: 42 })
    expect(rpc).toHaveBeenCalledWith('piping_rename_spool_column', { p_project: 'p1', p_column: 'c1', p_label: 'Khu vực' })
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses a blank label or a built-in header before calling', async () => {
    await expect(renameSpoolColumn('p1', 'c1', '  ')).rejects.toThrow('Tên cột không được để trống')
    await expect(renameSpoolColumn('p1', 'c1', 'line no')).rejects.toThrow('Tên cột "line no" trùng tên cột chuẩn LineNo')
    await expect(renameSpoolColumn('p1', 'c1', 'PH-Plan')).rejects.toThrow(/trùng tên cột chuẩn Painting Handover – Plan/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("keeps the function's Vietnamese messages", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Cột "Area" đã có trong dự án' } })
    await expect(renameSpoolColumn('p1', 'c1', 'Area')).rejects.toThrow('Cột "Area" đã có trong dự án')
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Chỉ admin được đổi tên cột' } })
    await expect(renameSpoolColumn('p1', 'c1', 'X')).rejects.toThrow('Chỉ admin được đổi tên cột')
  })

  it('names a unique-index race in Vietnamese', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    await expect(renameSpoolColumn('p1', 'c1', 'Area')).rejects.toThrow('Cột "Area" đã có trong dự án')
  })
})
