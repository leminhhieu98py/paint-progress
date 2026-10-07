import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builder } from '../../test/supabaseBuilder'
import { NO_PERMISSION, NOT_SAVED } from './shared'
import { addNote, deleteNote, listImportLog, listNotes, updateNote } from './notes'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
})

const NOTE = {
  id: 'n1', target: 'spool', day: null, spool_id: 's1', body: 'Chờ vật tư', author: 'u1', created_at: 't1',
  updated_by: null, updated_at: 't1', author_profile: { full_name: 'Admin' }, updater_profile: null,
}
const MAPPED = {
  id: 'n1', target: 'spool', day: null, spoolId: 's1', body: 'Chờ vật tư', authorId: 'u1', createdAt: 't1',
  updatedBy: null, updatedAt: 't1', authorName: 'Admin', updatedByName: null,
}

describe('notes', () => {
  it('lists notes with names, totally ordered', async () => {
    const b = builder({ data: [NOTE] })
    from.mockReturnValue(b)
    expect(await listNotes('p1')).toEqual([MAPPED])
    expect(from).toHaveBeenCalledWith('piping_notes')
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.order.mock.calls.map((c) => c[0])).toEqual(['created_at', 'id'])
    expect(String(b.select.mock.calls[0][0])).toContain('profiles!piping_notes_author_fkey')
  })

  it('adds a spool note in the table shape (day null)', async () => {
    const b = builder({ data: NOTE })
    from.mockReturnValue(b)
    expect(await addNote('p1', { target: 'spool', spoolId: 's1' }, ' Chờ vật tư ')).toEqual(MAPPED)
    expect(b.insert).toHaveBeenCalledWith({ project_id: 'p1', target: 'spool', day: null, spool_id: 's1', body: 'Chờ vật tư' })
  })

  it('adds a day note in the table shape (spool null)', async () => {
    const b = builder({ data: { ...NOTE, target: 'manpower_day', day: '2026-09-07', spool_id: null } })
    from.mockReturnValue(b)
    await addNote('p1', { target: 'manpower_day', day: '2026-09-07' }, 'Mưa')
    expect(b.insert).toHaveBeenCalledWith({
      project_id: 'p1', target: 'manpower_day', day: '2026-09-07', spool_id: null, body: 'Mưa',
    })
  })

  it('refuses a blank body or a missing anchor before writing', async () => {
    await expect(addNote('p1', { target: 'spool', spoolId: 's1' }, '  ')).rejects.toThrow(/không được để trống/)
    await expect(addNote('p1', { target: 'reinstatement_day', day: '' }, 'x')).rejects.toThrow('Thiếu ngày')
    await expect(addNote('p1', { target: 'spool', spoolId: '' }, 'x')).rejects.toThrow('Thiếu spool')
    await expect(updateNote('n1', '')).rejects.toThrow(/không được để trống/)
    expect(from).not.toHaveBeenCalled()
  })

  it('maps a non-admin insert refusal', async () => {
    from.mockReturnValue(builder({ error: { code: '42501', message: 'new row violates row-level security policy for table "piping_notes"' } }))
    await expect(addNote('p1', { target: 'spool', spoolId: 's1' }, 'x')).rejects.toThrow(NO_PERMISSION)
  })

  it('updates and deletes one note, reporting a swallowed write', async () => {
    const u = builder({ data: [{ id: 'n1' }] })
    from.mockReturnValueOnce(u)
    await updateNote('n1', ' Đã có vật tư ')
    expect(u.update).toHaveBeenCalledWith({ body: 'Đã có vật tư' })
    expect(u.eq).toHaveBeenCalledWith('id', 'n1')

    const d = builder({ data: [{ id: 'n1' }] })
    from.mockReturnValueOnce(d)
    await deleteNote('n1')
    expect(d.delete).toHaveBeenCalled()

    from.mockReturnValueOnce(builder({ data: [] }))
    await expect(updateNote('n1', 'x')).rejects.toThrow(NOT_SAVED)
    from.mockReturnValueOnce(builder({ data: [] }))
    await expect(deleteNote('n1')).rejects.toThrow(NOT_SAVED)
  })
})

describe('listImportLog', () => {
  it('lists newest first with the summary and the importer name', async () => {
    const b = builder({
      data: [{
        id: 'l1', kind: 'spool_actual', file_name: 'a.xlsx', row_count: 12, summary: { saved: 10, file_rows: 14 },
        imported_by: 'u1', imported_at: 't9', importer: { full_name: 'Admin' },
      }],
    })
    from.mockReturnValue(b)
    expect(await listImportLog('p1')).toEqual([{
      id: 'l1', kind: 'spool_actual', fileName: 'a.xlsx', rowCount: 12, summary: { saved: 10, file_rows: 14 },
      importedBy: 'u1', importedAt: 't9', importedByName: 'Admin',
    }])
    expect(from).toHaveBeenCalledWith('piping_import_log')
    expect(b.order).toHaveBeenCalledWith('imported_at', { ascending: false })
    expect(b.order).toHaveBeenCalledWith('id', { ascending: false })
  })

  it('maps a revoked grant', async () => {
    from.mockReturnValue(builder({ error: { code: '42501', message: 'permission denied for table piping_import_log' } }))
    await expect(listImportLog('p1')).rejects.toThrow(NO_PERMISSION)
  })
})
