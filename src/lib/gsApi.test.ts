import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cell } from '../domain/types'
import {
  listDeckCells, listDeckZones, loadGsProject, setCellStage, subscribeDeckCells,
  type GsRealtimeStatus,
} from './gsApi'

const from = vi.hoisted(() => vi.fn())
const channel = vi.hoisted(() => vi.fn())
const removeChannel = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  supabase: { from, channel, removeChannel },
}))

/** The PostgREST builder shape: every method chains, and awaiting resolves to
 *  `{ data, error }` -- postgrest-js reports failure as a value, never a throw. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'order', 'single']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

interface Binding {
  event: string
  table: string
  filter?: string
  callback: (payload: Record<string, unknown>) => void
}

/**
 * A stand-in for a RealtimeChannel, modelling the constraints of the real one
 * that this module's correctness depends on:
 *
 * - `.on()` and `.subscribe()` return the channel, so a chained call sequence
 *   works. A double returning undefined would let a broken chain pass.
 * - a payload reaches ONLY the handlers registered for that table and that
 *   event. Without this, a test asserting "onCellChange was called" would pass
 *   against a subscription bound to the wrong event or the wrong table.
 * - the subscribe callback is invoked with the state strings the real client
 *   uses ('SUBSCRIBED' / 'CHANNEL_ERROR' / 'TIMED_OUT' / 'CLOSED'), never a
 *   boolean.
 * - `removeChannel` is asserted to receive this very object, so a cleanup that
 *   removes something else, or nothing, is visible.
 */
function fakeChannel() {
  const bindings: Binding[] = []
  let statusCallback: ((status: string) => void) | null = null
  const ch = {
    bindings,
    on(type: string, filter: Record<string, unknown>, callback: Binding['callback']) {
      expect(type).toBe('postgres_changes')
      bindings.push({
        event: String(filter.event),
        table: String(filter.table),
        filter: filter.filter as string | undefined,
        callback,
      })
      return ch
    },
    subscribe(callback: (status: string) => void) {
      statusCallback = callback
      return ch
    },
    deliver(event: string, table: string, row: Record<string, unknown>) {
      for (const b of bindings) {
        if (b.event === event && b.table === table) b.callback({ new: row })
      }
    },
    setStatus(status: string) {
      statusCallback?.(status)
    },
  }
  return ch
}

beforeEach(() => {
  from.mockReset()
  channel.mockReset()
  removeChannel.mockReset()
})

describe('loadGsProject', () => {
  it('returns the project\'s stages and decks', async () => {
    from.mockImplementationOnce(() => builder({
      data: [
        { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.25000' },
        { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: '0.15000' },
      ],
    }))
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'd1', seq: 1, name: 'Cellar Deck', code: 'CD',
        image_path: 'p1/d1.png', image_w: 2000, image_h: 1600,
        total_area_m2: '6139.00', area_source: 'guides',
      }],
    }))

    const project = await loadGsProject('p1')

    // Weights and areas arrive from PostgREST as strings (numeric columns);
    // a missing Number() turns every later multiplication into NaN or a
    // concatenation, and NaN renders as "NaN%" rather than throwing.
    expect(project.stages).toEqual([
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
    ])
    expect(project.decks).toEqual([{
      id: 'd1', seq: 1, name: 'Cellar Deck', code: 'CD',
      imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
      totalAreaM2: 6139, areaSource: 'guides',
    }])
  })

  it('defaults a deck with no drawing yet to null image fields', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'd2', seq: 2, name: 'Main Deck', code: 'MD',
        image_path: null, image_w: null, image_h: null,
        total_area_m2: '0', area_source: 'prorated',
      }],
    }))

    const [deck] = (await loadGsProject('p1')).decks

    expect(deck.imagePath).toBeNull()
    expect(deck.imageW).toBeNull()
    expect(deck.imageH).toBeNull()
  })

  it('scopes the deck query to the project and orders by seq', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
    const decks = builder({ data: [] })
    from.mockImplementationOnce(() => decks)

    await loadGsProject('p1')

    // A missing project filter would show a foreman every project's decks --
    // RLS would still hide other projects' rows, so nothing would break loudly.
    expect(decks.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(decks.order).toHaveBeenCalledWith('seq')
  })

  it('throws when the deck query fails', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(loadGsProject('p1')).rejects.toThrow('permission denied')
  })

  it('throws when the stage query fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'JWT expired' } }))
    from.mockImplementationOnce(() => builder({ data: [] }))
    await expect(loadGsProject('p1')).rejects.toThrow('JWT expired')
  })
})

describe('listDeckCells', () => {
  it('returns a deck\'s cells as domain cells', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'c1', code: 'R1C1', x: '0.000000', y: '0.000000',
        w: '0.250000', h: '0.500000', area_m2: '148.000', stage_id: 's2',
      }],
    }))

    expect(await listDeckCells('d1')).toEqual([{
      id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.25, h: 0.5, areaM2: 148, stageId: 's2',
    }])
  })

  it('reads a null stage as not started', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{ id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, area_m2: '10', stage_id: null }],
    }))
    expect((await listDeckCells('d1'))[0].stageId).toBeNull()
  })

  it('scopes the query to the deck and orders by code', async () => {
    const stub = builder({ data: [] })
    from.mockImplementationOnce(() => stub)

    await listDeckCells('d1')

    expect(stub.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(stub.order).toHaveBeenCalledWith('code')
  })

  it('throws when the query fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(listDeckCells('d1')).rejects.toThrow('permission denied')
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

describe('setCellStage', () => {
  it('sends stage_id and nothing else', async () => {
    const stub = builder({ data: null })
    from.mockImplementationOnce(() => stub)

    await setCellStage('c1', 's3')

    // The load-bearing assertion of this module. cells_assert_gs_stage_only
    // rejects the WHOLE update if any other column differs, so a payload that
    // also carries updated_at (or the whole cell row) fails in production with
    // "only stage_id may be changed by a non-admin" -- which reads like a
    // permissions bug and is not one. The key count is asserted, not just the
    // value, because toHaveBeenCalledWith on a superset object would pass.
    expect(stub.update).toHaveBeenCalledWith({ stage_id: 's3' })
    const payload = (stub.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as object
    expect(Object.keys(payload)).toEqual(['stage_id'])
    expect(stub.eq).toHaveBeenCalledWith('id', 'c1')
  })

  it('can clear a cell back to not started', async () => {
    const stub = builder({ data: null })
    from.mockImplementationOnce(() => stub)

    await setCellStage('c1', null)

    expect(stub.update).toHaveBeenCalledWith({ stage_id: null })
  })

  it('throws when the update is refused', async () => {
    from.mockImplementationOnce(() => builder({
      error: { message: 'only stage_id may be changed by a non-admin' },
    }))
    await expect(setCellStage('c1', 's3'))
      .rejects.toThrow('only stage_id may be changed by a non-admin')
  })
})

describe('subscribeDeckCells', () => {
  it('subscribes to one deck\'s cells, on its own channel', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)

    subscribeDeckCells('d1', { onCellChange: vi.fn(), onStatus: vi.fn() })

    expect(channel).toHaveBeenCalledWith('gs-cells-d1')
    // Every binding is scoped to this deck. Without the filter a foreman
    // watching the Cellar Deck would fold the Main Deck's cells into the
    // Cellar's cell list -- and its percentages.
    expect(ch.bindings.map((b) => b.event)).toEqual(['INSERT', 'UPDATE'])
    for (const binding of ch.bindings) {
      expect(binding.table).toBe('cells')
      expect(binding.filter).toBe('deck_id=eq.d1')
    }
  })

  it('reports an updated cell as a domain cell', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const onCellChange = vi.fn<(cell: Cell) => void>()

    subscribeDeckCells('d1', { onCellChange, onStatus: vi.fn() })
    ch.deliver('UPDATE', 'cells', {
      id: 'c1', code: 'R1C1', x: '0.1', y: '0.2', w: '0.3', h: '0.4',
      area_m2: '148.000', stage_id: 's4', deck_id: 'd1',
    })

    // Realtime serialises numeric columns as JSON and its own type conversion
    // has changed across versions, so every numeric field is coerced here. An
    // areaM2 of "148.000" would make the pie's sums string-concatenate.
    expect(onCellChange).toHaveBeenCalledWith({
      id: 'c1', code: 'R1C1', x: 0.1, y: 0.2, w: 0.3, h: 0.4, areaM2: 148, stageId: 's4',
    })
  })

  it('reports an inserted cell too', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const onCellChange = vi.fn<(cell: Cell) => void>()

    subscribeDeckCells('d1', { onCellChange, onStatus: vi.fn() })
    ch.deliver('INSERT', 'cells', {
      id: 'c9', code: 'R9C9', x: 0, y: 0, w: 1, h: 1, area_m2: '5', stage_id: null,
    })

    expect(onCellChange).toHaveBeenCalledWith(
      { id: 'c9', code: 'R9C9', x: 0, y: 0, w: 1, h: 1, areaM2: 5, stageId: null },
    )
  })

  it('reports the channel state as connected or not', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const seen: GsRealtimeStatus[] = []

    subscribeDeckCells('d1', { onCellChange: vi.fn(), onStatus: (s) => seen.push(s) })

    ch.setStatus('SUBSCRIBED')
    ch.setStatus('CHANNEL_ERROR')
    ch.setStatus('TIMED_OUT')
    ch.setStatus('CLOSED')
    ch.setStatus('SUBSCRIBED')

    // All three failure states must map to 'disconnected'. A check for
    // CHANNEL_ERROR alone leaves a tethered tablet showing stale data with no
    // banner, which is exactly what spec §11 row 2 forbids.
    expect(seen).toEqual([
      'subscribed', 'disconnected', 'disconnected', 'disconnected', 'subscribed',
    ])
  })

  it('removes the channel it created when unsubscribed', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)

    const unsubscribe = subscribeDeckCells('d1', { onCellChange: vi.fn(), onStatus: vi.fn() })
    expect(removeChannel).not.toHaveBeenCalled()

    unsubscribe()

    // By identity: a leaked channel keeps delivering into an unmounted
    // component's setState, and switching decks would accumulate one live
    // socket subscription per tab visited.
    expect(removeChannel).toHaveBeenCalledWith(ch)
  })
})
