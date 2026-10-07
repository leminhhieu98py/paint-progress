import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builder, type MockBuilder } from '../../test/supabaseBuilder'
import { NOT_SAVED } from './shared'
import {
  RENAME_CHUNK, RENAME_CONFLICT, addSpoolColumn, deleteSpoolColumn, listSpoolColumns, renameSpoolColumn,
  reorderSpoolColumns,
} from './spoolColumns'

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

  it('reorders and deletes', async () => {
    const o = builder({ data: [{ id: 'c2' }] })
    from.mockReturnValueOnce(o)
    await reorderSpoolColumns(['c2'])
    expect(o.update).toHaveBeenCalledWith({ sort: 1 })

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
  /** Routes each `from(table)` to the next builder queued for it. */
  function route(queues: Record<string, MockBuilder[]>) {
    from.mockImplementation((table: string) => {
      const next = queues[table]?.shift()
      if (!next) throw new Error(`unexpected from(${table})`)
      return next
    })
  }

  it('moves the key in every spool, grouped by extra, guarded by equality, then renames the column', async () => {
    const spools = [
      { id: 's1', extra: { Zone: 'A', Area: '1' } },
      { id: 's2', extra: { Zone: 'A', Area: '1' } },
      { id: 's3', extra: { Zone: 'B' } },
      { id: 's4', extra: { Area: '2' } },
      { id: 's5', extra: {} },
    ]
    const g1 = builder({ data: [{ id: 's1' }, { id: 's2' }] })
    const g2 = builder({ data: [{ id: 's3' }] })
    const label = builder({ data: [{ id: 'c1' }] })
    route({
      piping_spool_columns: [builder({ data: COLUMNS }), label],
      piping_spools: [builder({ data: spools }), g1, g2],
    })
    const progress = vi.fn()

    expect(await renameSpoolColumn('p1', 'c1', ' Khu vực ', progress)).toEqual({ spoolsUpdated: 3 })

    expect(g1.update).toHaveBeenCalledWith({ extra: { 'Khu vực': 'A', Area: '1' } })
    expect(g1.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(g1.in).toHaveBeenCalledWith('id', ['s1', 's2'])
    expect(g1.contains).toHaveBeenCalledWith('extra', { Zone: 'A', Area: '1' })
    expect(g1.containedBy).toHaveBeenCalledWith('extra', { Zone: 'A', Area: '1' })
    expect(g2.update).toHaveBeenCalledWith({ extra: { 'Khu vực': 'B' } })
    expect(g2.in).toHaveBeenCalledWith('id', ['s3'])
    expect(label.update).toHaveBeenCalledWith({ label: 'Khu vực' })
    expect(label.eq).toHaveBeenCalledWith('id', 'c1')
    expect(progress).toHaveBeenLastCalledWith(3, 3)
  })

  it('splits a large group into chunks of RENAME_CHUNK ids', async () => {
    const spools = Array.from({ length: RENAME_CHUNK + 1 }, (_, i) => ({ id: `s${i}`, extra: { Zone: 'A' } }))
    const c1 = builder({ data: spools.slice(0, RENAME_CHUNK) })
    const c2 = builder({ data: spools.slice(RENAME_CHUNK) })
    route({
      piping_spool_columns: [builder({ data: COLUMNS }), builder({ data: [{ id: 'c1' }] })],
      piping_spools: [builder({ data: spools }), c1, c2],
    })
    expect(await renameSpoolColumn('p1', 'c1', 'Khu')).toEqual({ spoolsUpdated: RENAME_CHUNK + 1 })
    expect((c1.in.mock.calls[0][1] as string[]).length).toBe(RENAME_CHUNK)
    expect(c2.in).toHaveBeenCalledWith('id', [`s${RENAME_CHUNK}`])
  })

  it("lets the renamed column's value win over a key left by a deleted column", async () => {
    const g = builder({ data: [{ id: 's1' }] })
    route({
      piping_spool_columns: [builder({ data: COLUMNS }), builder({ data: [{ id: 'c1' }] })],
      piping_spools: [builder({ data: [{ id: 's1', extra: { Khu: 'old', Zone: 'A' } }] }), g],
    })
    await renameSpoolColumn('p1', 'c1', 'Khu')
    expect(g.update).toHaveBeenCalledWith({ extra: { Khu: 'A' } })
  })

  it('stops before renaming the column when a guard matched fewer spools than sent', async () => {
    const label = builder({ data: [{ id: 'c1' }] })
    route({
      piping_spool_columns: [builder({ data: COLUMNS }), label],
      piping_spools: [
        builder({ data: [{ id: 's1', extra: { Zone: 'A' } }, { id: 's2', extra: { Zone: 'A' } }] }),
        builder({ data: [{ id: 's1' }] }),
      ],
    })
    await expect(renameSpoolColumn('p1', 'c1', 'Khu')).rejects.toThrow(RENAME_CONFLICT)
    expect(label.update).not.toHaveBeenCalled()
  })

  it('stops on a write error before renaming the column', async () => {
    const label = builder({ data: [{ id: 'c1' }] })
    route({
      piping_spool_columns: [builder({ data: COLUMNS }), label],
      piping_spools: [builder({ data: [{ id: 's1', extra: { Zone: 'A' } }] }), builder({ error: { message: 'boom' } })],
    })
    await expect(renameSpoolColumn('p1', 'c1', 'Khu')).rejects.toThrow('boom')
    expect(label.update).not.toHaveBeenCalled()
  })

  it('refuses a label another column has, case- and space-blind, before touching spools', async () => {
    route({ piping_spool_columns: [builder({ data: COLUMNS })] })
    await expect(renameSpoolColumn('p1', 'c1', ' area ')).rejects.toThrow('Cột "area" đã có trong dự án')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('does nothing for the same label, and reports a column that is gone', async () => {
    route({ piping_spool_columns: [builder({ data: COLUMNS }), builder({ data: COLUMNS })] })
    expect(await renameSpoolColumn('p1', 'c1', 'Zone')).toEqual({ spoolsUpdated: 0 })
    await expect(renameSpoolColumn('p1', 'c9', 'X')).rejects.toThrow(NOT_SAVED)
  })

  it('renames a column no spool uses with one write', async () => {
    const label = builder({ data: [{ id: 'c1' }] })
    route({
      piping_spool_columns: [builder({ data: COLUMNS }), label],
      piping_spools: [builder({ data: [{ id: 's1', extra: {} }] })],
    })
    expect(await renameSpoolColumn('p1', 'c1', 'zone')).toEqual({ spoolsUpdated: 0 })
    expect(label.update).toHaveBeenCalledWith({ label: 'zone' })
  })
})
