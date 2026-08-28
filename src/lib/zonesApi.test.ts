import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createZone, deleteZone, listDeckZones, setZoneActual, updateZone,
} from './zonesApi'

const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from } }))

/** The PostgREST builder shape: every method chains, and awaiting resolves to
 *  `{ data, error }` -- postgrest-js reports failure as a value, never a throw. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'single']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

const DRAFT = {
  name: 'Khu A',
  stageId: 's5',
  startDate: '2026-09-01',
  finishDate: '2026-09-07',
}

beforeEach(() => {
  from.mockReset()
})

describe('createZone', () => {
  it('inserts the zone then attaches every selected cell', async () => {
    const seqRead = builder({ data: [{ seq: 2 }] })
    const zoneInsert = builder({ data: { id: 'z1' } })
    const linkInsert = builder({})
    from
      .mockImplementationOnce(() => seqRead)
      .mockImplementationOnce(() => zoneInsert)
      .mockImplementationOnce(() => linkInsert)

    const id = await createZone('d1', DRAFT, ['c1', 'c2'])

    expect(id).toBe('z1')
    expect(zoneInsert.insert).toHaveBeenCalledWith({
      deck_id: 'd1', seq: 3, name: 'Khu A', stage_id: 's5',
      start_date: '2026-09-01', finish_date: '2026-09-07',
    })
    expect(linkInsert.insert).toHaveBeenCalledWith([
      { zone_id: 'z1', cell_id: 'c1' },
      { zone_id: 'z1', cell_id: 'c2' },
    ])
  })

  it('numbers the first zone of a stage 1', async () => {
    from
      .mockImplementationOnce(() => builder({ data: [] }))
      .mockImplementationOnce(() => builder({ data: { id: 'z1' } }))
      .mockImplementationOnce(() => builder({}))

    await createZone('d1', DRAFT, ['c1'])

    const insert = (from.mock.results[1].value as { insert: ReturnType<typeof vi.fn> }).insert
    expect(insert.mock.calls[0][0]).toMatchObject({ seq: 1 })
  })

  it('reads the highest seq within this deck AND this stage', async () => {
    // `unique (deck_id, stage_id, seq)` (0001) counts per stage, not per deck.
    // Scoping the read to the deck alone would leave gaps; dropping the stage
    // filter and inserting the deck-wide max is legal but numbers the first
    // zone of a new stage 4 rather than 1.
    const seqRead = builder({ data: [{ seq: 9 }] })
    from
      .mockImplementationOnce(() => seqRead)
      .mockImplementationOnce(() => builder({ data: { id: 'z1' } }))
      .mockImplementationOnce(() => builder({}))

    await createZone('d1', DRAFT, ['c1'])

    expect(seqRead.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(seqRead.eq).toHaveBeenCalledWith('stage_id', 's5')
  })

  it('refuses a zone with no cells, before writing anything', async () => {
    // A zone nobody can see is worse than no zone: it takes a row in the table,
    // labels nothing on the drawing, and "Set actual" over it writes to zero
    // cells while reporting success.
    await expect(createZone('d1', DRAFT, [])).rejects.toThrow(/at least one cell/)
    expect(from).not.toHaveBeenCalled()
  })

  it('deletes the zone again when attaching its cells fails', async () => {
    // Two statements, no transaction. A zone with no members is the exact shape
    // the guard above refuses to create, so it must not be left behind either.
    from
      .mockImplementationOnce(() => builder({ data: [] }))
      .mockImplementationOnce(() => builder({ data: { id: 'z1' } }))
      .mockImplementationOnce(() => builder({ error: { message: 'deadlock detected' } }))
    const rollback = builder({})
    from.mockImplementationOnce(() => rollback)

    await expect(createZone('d1', DRAFT, ['c1'])).rejects.toThrow('deadlock detected')

    expect(rollback.delete).toHaveBeenCalled()
    expect(rollback.eq).toHaveBeenCalledWith('id', 'z1')
  })

  it('throws when the zone insert fails, and attaches nothing', async () => {
    from
      .mockImplementationOnce(() => builder({ data: [] }))
      .mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))

    await expect(createZone('d1', DRAFT, ['c1'])).rejects.toThrow('permission denied')
    expect(from).toHaveBeenCalledTimes(2)
  })
})

describe('updateZone', () => {
  it('writes only the fields it was given, on the right zone', async () => {
    // A patch, not a replace: the dates are edited inline in the table, one cell
    // at a time, and sending the whole row would let a stale name overwrite a
    // rename made in another tab.
    const b = builder({})
    from.mockImplementationOnce(() => b)

    await updateZone('z1', { finishDate: '2026-09-10' })

    expect(b.update).toHaveBeenCalledWith({ finish_date: '2026-09-10' })
    expect(b.eq).toHaveBeenCalledWith('id', 'z1')
  })

  it('can clear a date', async () => {
    // null is a value here, not "unset". `finishDate: null` means the finish is
    // no longer known, and a patch builder that skipped nullish values would
    // make that impossible to express.
    const b = builder({})
    from.mockImplementationOnce(() => b)

    await updateZone('z1', { startDate: null })

    expect(b.update).toHaveBeenCalledWith({ start_date: null })
  })

  it('writes nothing at all when given no fields', async () => {
    await updateZone('z1', {})
    expect(from).not.toHaveBeenCalled()
  })

  it('throws when the update fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(updateZone('z1', { name: 'x' })).rejects.toThrow('permission denied')
  })
})

describe('deleteZone', () => {
  it('deletes by id, and zone_cells goes with it', async () => {
    const b = builder({})
    from.mockImplementationOnce(() => b)

    await deleteZone('z1')

    expect(from).toHaveBeenCalledWith('zones')
    expect(b.delete).toHaveBeenCalled()
    expect(b.eq).toHaveBeenCalledWith('id', 'z1')
  })

  it('throws when the delete fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(deleteZone('z1')).rejects.toThrow('permission denied')
  })
})

describe('setZoneActual', () => {
  it('stamps the stage across every cell of the zone, and reports how many', async () => {
    from
      .mockImplementationOnce(() => builder({ data: [{ cell_id: 'c1' }, { cell_id: 'c2' }] }))
      .mockImplementationOnce(() => builder({ data: [{ id: 'c1' }, { id: 'c2' }] }))

    expect(await setZoneActual('z1', 's5')).toBe(2)

    const update = (from.mock.results[1].value as { update: ReturnType<typeof vi.fn> }).update
    expect(update).toHaveBeenCalledWith({ stage_id: 's5' })
  })

  it('scopes the write to this zone\'s cells by id', async () => {
    from.mockImplementationOnce(() => builder({ data: [{ cell_id: 'c1' }] }))
    const write = builder({ data: [{ id: 'c1' }] })
    from.mockImplementationOnce(() => write)

    await setZoneActual('z1', 's5')

    // `.in('id', ...)`, never `.eq('deck_id', ...)`. A deck-scoped write would
    // stamp every bay on the deck from a button labelled with one zone's name.
    expect(write.in).toHaveBeenCalledWith('id', ['c1'])
  })

  it('writes nothing when the zone has no cells', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))

    expect(await setZoneActual('z1', 's5')).toBe(0)
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('throws when the membership read fails, before writing', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(setZoneActual('z1', 's5')).rejects.toThrow('permission denied')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('throws when the stage write fails', async () => {
    from
      .mockImplementationOnce(() => builder({ data: [{ cell_id: 'c1' }] }))
      .mockImplementationOnce(() => builder({ error: { message: 'stage does not belong to deck' } }))

    await expect(setZoneActual('z1', 's5')).rejects.toThrow('stage does not belong to deck')
  })
})

describe('listDeckZones', () => {
  it('returns a deck\'s zones with their cell ids', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'z1', name: 'Zone 1', stage_id: 's5',
        start_date: '2026-08-13', finish_date: '2026-08-19',
        zone_cells: [{ cell_id: 'c1' }, { cell_id: 'c2' }],
      }],
    }))

    expect(await listDeckZones('d1')).toEqual([{
      id: 'z1', name: 'Zone 1', stageId: 's5',
      startDate: '2026-08-13', finishDate: '2026-08-19',
      cellIds: ['c1', 'c2'],
    }])
  })

  it('returns an unscheduled zone with null dates and an empty membership', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'z2', name: 'Zone 2', stage_id: 's5',
        start_date: null, finish_date: null, zone_cells: [],
      }],
    }))

    const [zone] = await listDeckZones('d1')
    expect(zone.startDate).toBeNull()
    expect(zone.finishDate).toBeNull()
    expect(zone.cellIds).toEqual([])
  })

  it('scopes the query to the deck and orders by seq', async () => {
    const stub = builder({ data: [] })
    from.mockImplementationOnce(() => stub)

    await listDeckZones('d1')

    // seq order is what lets a later zone win a cell two zones claim.
    expect(stub.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(stub.order).toHaveBeenCalledWith('seq')
  })

  it('throws when the query fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(listDeckZones('d1')).rejects.toThrow('permission denied')
  })
})
