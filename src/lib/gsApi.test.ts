import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cell } from '../domain/types'
import {
  listDeckCells, loadGsProject, setCellStage, subscribeDeckCells,
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
  for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'single']) {
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
 * - a DELETE payload carries the removed row as `old` and leaves `new` empty,
 *   which is what the real service sends. A double that put the row in `new` for
 *   every event would let a DELETE handler reading `payload.new` pass here and
 *   throw on a tablet.
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
        if (b.event !== event || b.table !== table) continue
        // The real payload shape, per event: a DELETE reports the removed row as
        // `old` and sends `new` as an empty object, INSERT and UPDATE the reverse.
        b.callback(event === 'DELETE' ? { old: row, new: {} } : { new: row, old: {} })
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

/**
 * loadGsProject issues its two queries inside one Promise.all, in the order they
 * appear in that array: decks, then project_members. `from` is mocked per call,
 * so every test here has to queue both.
 *
 * Stages are not among them: they are declared per deck now, and the GS screen
 * fetches the active deck's own set when the foreman picks one.
 */
const MEMBER = [{ project_id: 'p1' }]

describe('loadGsProject', () => {
  it('returns the project\'s decks', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'd1', seq: 1, name: 'Cellar Deck', code: 'CD',
        image_path: 'p1/d1.png', image_w: 2000, image_h: 1600,
        total_area_m2: '6139.00', area_source: 'guides',
      }],
    }))
    from.mockImplementationOnce(() => builder({ data: MEMBER }))

    const project = await loadGsProject('p1')

    // Areas arrive from PostgREST as strings (numeric columns); a missing
    // Number() turns every later division into NaN or a concatenation, and NaN
    // renders as "NaN%" rather than throwing.
    expect(project.decks).toEqual([{
      id: 'd1', seq: 1, name: 'Cellar Deck', code: 'CD',
      imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
      totalAreaM2: 6139, areaSource: 'guides',
    }])
    expect(project.isMember).toBe(true)
  })

  it('defaults a deck with no drawing yet to null image fields', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'd2', seq: 2, name: 'Main Deck', code: 'MD',
        image_path: null, image_w: null, image_h: null,
        total_area_m2: '0', area_source: 'prorated',
      }],
    }))
    from.mockImplementationOnce(() => builder({ data: MEMBER }))

    const [deck] = (await loadGsProject('p1')).decks

    expect(deck.imagePath).toBeNull()
    expect(deck.imageW).toBeNull()
    expect(deck.imageH).toBeNull()
  })

  it('scopes the deck query to the project and orders by seq', async () => {
    const decks = builder({ data: [] })
    from.mockImplementationOnce(() => decks)
    from.mockImplementationOnce(() => builder({ data: MEMBER }))

    await loadGsProject('p1')

    // A missing project filter would show a foreman every project's decks --
    // RLS would still hide other projects' rows, so nothing would break loudly.
    expect(decks.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(decks.order).toHaveBeenCalledWith('seq')
  })

  it('reports membership in THIS project, asking project_members for it', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
    const members = builder({ data: MEMBER })
    from.mockImplementationOnce(() => members)

    expect((await loadGsProject('p1')).isMember).toBe(true)

    // Scoped to the project in the route, and to this table. Without the filter
    // `project_members_self_read` still returns the caller's OTHER projects, so
    // any GS assigned to anything would read as a member of every project id --
    // which is precisely the refusal this field exists to detect.
    expect(from).toHaveBeenCalledWith('project_members')
    expect(members.eq).toHaveBeenCalledWith('project_id', 'p1')
  })

  it('reports no membership when RLS returns nothing, without erroring', async () => {
    // The deep-link case. RLS answers a non-member with zero rows and NO error
    // for both queries, so an empty project and a refusal are identical from the
    // outside -- this flag is the only thing that separates them.
    from.mockImplementationOnce(() => builder({ data: [] }))
    from.mockImplementationOnce(() => builder({ data: [] }))

    const project = await loadGsProject('p9')

    expect(project.isMember).toBe(false)
    expect(project.decks).toEqual([])
  })

  it('throws when the deck query fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    from.mockImplementationOnce(() => builder({ data: MEMBER }))
    await expect(loadGsProject('p1')).rejects.toThrow('permission denied')
  })

  it('throws when the membership query fails instead of reporting a refusal', async () => {
    // A dropped tether must not be reported as "you are not in this project":
    // that sends a foreman to find the administrator over a network fault, and
    // the administrator finds nothing wrong.
    from.mockImplementationOnce(() => builder({ data: [] }))
    from.mockImplementationOnce(() => builder({ error: { message: 'Failed to fetch' } }))
    await expect(loadGsProject('p1')).rejects.toThrow('Failed to fetch')
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

describe('setCellStage', () => {
  it('sends stage_id and nothing else', async () => {
    const stub = builder({ data: [{ id: 'c1' }] })
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

  it('throws when the update matched no row at all', async () => {
    // PostgREST answers a zero-row UPDATE with 204 and NO error, so without
    // asking for the affected rows back this function would report success
    // while the database was never touched. Reachable from a tablet: the admin
    // deleted or merged the cell (DELETE is unsubscribed, so it is still on the
    // foreman's drawing and still tappable), or their project_members row was
    // removed and the RLS USING clause now filters the row out -- a zero-row
    // update, not an error. Verified against the live project: status 204,
    // error null, data null.
    const stub = builder({ data: [] })
    from.mockImplementationOnce(() => stub)

    await expect(setCellStage('c1', 's3')).rejects.toThrow(/was not updated/)
    expect(stub.select).toHaveBeenCalledWith('id')
  })

  it('can clear a cell back to not started', async () => {
    const stub = builder({ data: [{ id: 'c1' }] })
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

    subscribeDeckCells('d1', {
      onCellChange: vi.fn(), onCellDelete: vi.fn(), onStatus: vi.fn(),
    })

    expect(channel).toHaveBeenCalledWith('gs-cells-d1')
    // Every binding is scoped to this deck. Without the filter a foreman
    // watching the Cellar Deck would fold the Main Deck's cells into the
    // Cellar's cell list -- and its percentages.
    //
    // DELETE is in the list, and its absence was a real defect: a merge in the
    // deck editor is one UPDATE of the survivor plus a DELETE of each absorbed
    // cell, so without it the absorbed cells stayed on the foreman's drawing
    // with their area counted twice. The deck_id filter on it only works because
    // migration 0016 sets replica identity full -- under the default identity the
    // old record carries the primary key alone, and Realtime drops the event
    // rather than deliver it, filter or no filter.
    expect(ch.bindings.map((b) => b.event)).toEqual(['INSERT', 'UPDATE', 'DELETE'])
    for (const binding of ch.bindings) {
      expect(binding.table).toBe('cells')
      expect(binding.filter).toBe('deck_id=eq.d1')
    }
  })

  it('reports an updated cell as a domain cell', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const onCellChange = vi.fn<(cell: Cell) => void>()

    subscribeDeckCells('d1', { onCellChange, onCellDelete: vi.fn(), onStatus: vi.fn() })
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

    subscribeDeckCells('d1', { onCellChange, onCellDelete: vi.fn(), onStatus: vi.fn() })
    ch.deliver('INSERT', 'cells', {
      id: 'c9', code: 'R9C9', x: 0, y: 0, w: 1, h: 1, area_m2: '5', stage_id: null,
    })

    expect(onCellChange).toHaveBeenCalledWith(
      { id: 'c9', code: 'R9C9', x: 0, y: 0, w: 1, h: 1, areaM2: 5, stageId: null },
    )
  })

  it('reports a deleted cell by id, off the OLD record', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const onCellChange = vi.fn<(cell: Cell) => void>()
    const onCellDelete = vi.fn<(cellId: string) => void>()

    subscribeDeckCells('d1', { onCellChange, onCellDelete, onStatus: vi.fn() })
    ch.deliver('DELETE', 'cells', {
      id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 0.5,
      area_m2: '200.000', stage_id: 's2', deck_id: 'd1',
    })

    // The id, not a mapped Cell: there is nothing left to render, and a delete
    // handler that went through mapCellRow on `payload.new` would read an empty
    // object and hand the screen `undefined` as an id -- which removes nothing
    // and reports no error.
    expect(onCellDelete).toHaveBeenCalledWith('c2')
    // And it must NOT arrive as a change: folding a deleted row back into the
    // cell list is the same phantom area, by a different route.
    expect(onCellChange).not.toHaveBeenCalled()
  })

  it('reports the channel state as connected or not', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const seen: GsRealtimeStatus[] = []

    subscribeDeckCells('d1', {
      onCellChange: vi.fn(), onCellDelete: vi.fn(), onStatus: (s) => seen.push(s),
    })

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

    const unsubscribe = subscribeDeckCells('d1', {
      onCellChange: vi.fn(), onCellDelete: vi.fn(), onStatus: vi.fn(),
    })
    expect(removeChannel).not.toHaveBeenCalled()

    unsubscribe()

    // By identity: a leaked channel keeps delivering into an unmounted
    // component's setState, and switching decks would accumulate one live
    // socket subscription per tab visited.
    expect(removeChannel).toHaveBeenCalledWith(ch)
  })
})
