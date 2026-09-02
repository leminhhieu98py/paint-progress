import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cell } from '../domain/types'
import {
  listCoworkerNames, listDeckCells, listDeckStates, listDeckWorks, listProjectIndex,
  listProjectStageIndex, loadGsProject, loadGsProjectIdentity, setCellStage, setCellState,
  subscribeDeckCells, subscribeDeckStates, type GsRealtimeStatus,
} from './gsApi'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
const channel = vi.hoisted(() => vi.fn())
const removeChannel = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  supabase: { from, rpc, channel, removeChannel },
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
  it('returns a deck\'s cells as domain cells, geometry only', async () => {
    // Since 0024 a bay's position lives in cell_states, per work. Geometry
    // comes back not started; the screen lays the selected work's states over it.
    const stub = builder({
      data: [{
        id: 'c1', code: 'R1C1', x: '0.000000', y: '0.000000',
        w: '0.250000', h: '0.500000', area_m2: '148.000',
      }],
    })
    from.mockImplementationOnce(() => stub)

    expect(await listDeckCells('d1')).toEqual([{
      id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.25, h: 0.5, areaM2: 148, stageId: null, note: '',
    }])
    expect(stub.select).toHaveBeenCalledWith(expect.not.stringContaining('stage_id'))
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

describe('listProjectStageIndex', () => {
  it('keeps each deck\'s bays with that deck\'s own coats', async () => {
    // Every deck declares its own stage list, with its own ids. Reading one
    // deck's cells against another's stages counts every bay as not started,
    // which is how a deck that is 37% along reported 0% on the tab a foreman
    // was choosing by.
    from.mockImplementationOnce(() => builder({
      data: [
        { deck_id: 'd1', area_m2: 100, stage_id: 'a1' },
        { deck_id: 'd2', area_m2: 200, stage_id: 'b1' },
      ],
    }))
    from.mockImplementationOnce(() => builder({
      data: [
        { deck_id: 'd1', id: 'a1', seq: 1, name: 'Coat 1', color: '#111111', weight: 1 },
        { deck_id: 'd2', id: 'b1', seq: 1, name: 'Lót', color: '#222222', weight: 1 },
      ],
    }))

    const index = await listProjectStageIndex(['d1', 'd2'])

    expect(index.d1.stages.map((st) => st.id)).toEqual(['a1'])
    expect(index.d2.stages.map((st) => st.id)).toEqual(['b1'])
    expect(index.d1.cells).toEqual([{ areaM2: 100, stageId: 'a1' }])
    expect(index.d2.cells).toEqual([{ areaM2: 200, stageId: 'b1' }])
  })

  it('gives a deck with no bays and no coats an entry, not a hole', async () => {
    // The caller divides by these. A missing key would throw on the tab rather
    // than read 0%.
    from.mockImplementationOnce(() => builder({ data: [] }))
    from.mockImplementationOnce(() => builder({ data: [] }))

    const index = await listProjectStageIndex(['d9'])

    expect(index.d9).toEqual({ cells: [], stages: [] })
  })

  it('orders each deck\'s coats by seq, because cumulative progress reads them in order', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
    from.mockImplementationOnce(() => builder({
      data: [
        { deck_id: 'd1', id: 's2', seq: 2, name: 'Coat 2', color: '#222222', weight: 0.5 },
        { deck_id: 'd1', id: 's1', seq: 1, name: 'Coat 1', color: '#111111', weight: 0.5 },
      ],
    }))

    const index = await listProjectStageIndex(['d1'])

    expect(index.d1.stages.map((st) => st.seq)).toEqual([1, 2])
  })

  it('asks for nothing when there are no decks', async () => {
    expect(await listProjectStageIndex([])).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })
})

describe('setCellStage', () => {
  it('sends stage_id and note and nothing else', async () => {
    const stub = builder({ data: [{ id: 'c1' }] })
    from.mockImplementationOnce(() => stub)

    await setCellStage('c1', 's3')

    // The load-bearing assertion of this module. cells_assert_gs_stage_only
    // rejects the WHOLE update if any other column differs, so a payload that
    // also carries updated_at (or the whole cell row) fails in production with
    // "only stage_id and note may be changed by a non-admin" -- which reads
    // like a permissions bug and is not one. The key count is asserted, not
    // just the value, because toHaveBeenCalledWith on a superset object would
    // pass.
    expect(stub.update).toHaveBeenCalledWith({ stage_id: 's3', note: '' })
    const payload = (stub.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as object
    expect(Object.keys(payload).sort()).toEqual(['note', 'stage_id'])
    expect(stub.eq).toHaveBeenCalledWith('id', 'c1')
  })

  it('carries the note in the same statement as the stage', async () => {
    // Two statements would be two failure points on the one write a foreman
    // makes, and 0019's guard refuses a note that arrives without a stage
    // change -- which is what keeps cell_events a complete record of notes.
    const stub = builder({ data: [{ id: 'c1' }] })
    from.mockImplementationOnce(() => stub)

    await setCellStage('c1', 's3', 'Bề mặt còn ẩm')

    expect(stub.update).toHaveBeenCalledWith({ stage_id: 's3', note: 'Bề mặt còn ẩm' })
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('clears the note when a stage change carries none', async () => {
    // A bay that gets a new coat and no comment must not keep the note that
    // explained the coat before it -- the note describes ONE change, and
    // cells.note only ever holds the latest.
    const stub = builder({ data: [{ id: 'c1' }] })
    from.mockImplementationOnce(() => stub)

    await setCellStage('c1', null)

    expect(stub.update).toHaveBeenCalledWith({ stage_id: null, note: '' })
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

    expect(stub.update).toHaveBeenCalledWith({ stage_id: null, note: '' })
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
      id: 'c1', code: 'R1C1', x: 0.1, y: 0.2, w: 0.3, h: 0.4, areaM2: 148, stageId: 's4', note: '',
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
      { id: 'c9', code: 'R9C9', x: 0, y: 0, w: 1, h: 1, areaM2: 5, stageId: null, note: '' },
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

describe('listCoworkerNames', () => {
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
  })

  it('asks the database for the names a tablet may see, not the profiles table', async () => {
    // profiles is admin-only plus the caller's own row. A GS reading it
    // directly gets nobody; the definer function hands back id and full name
    // for co-members and admins, and nothing else about them.
    rpc.mockResolvedValue({
      data: [
        { id: 'u1', full_name: 'Lê Trung Hiếu' },
        { id: 'a1', full_name: 'Đoàn Công Linh' },
      ],
      error: null,
    })

    const names = await listCoworkerNames()

    expect(rpc).toHaveBeenCalledWith('coworker_names')
    expect(from).not.toHaveBeenCalled()
    expect(names).toEqual({ u1: 'Lê Trung Hiếu', a1: 'Đoàn Công Linh' })
  })

  it('returns an empty map when the database returns nothing', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await listCoworkerNames()).toEqual({})
  })

  it('reports a failed read rather than an empty map', async () => {
    // An empty map and a failed read render the same -- "Không rõ người ghi"
    // on every note. The caller decides to swallow that, not this function.
    rpc.mockResolvedValue({ data: null, error: { message: 'mất kết nối' } })
    await expect(listCoworkerNames()).rejects.toThrow('mất kết nối')
  })
})

describe('loadGsProjectIdentity', () => {
  beforeEach(() => {
    from.mockReset()
  })

  it('reads the project code and name the export file is named after', async () => {
    const b = builder({ data: [{ code: 'BB1', name: 'BlockB1_CPPTS' }] })
    from.mockImplementation(() => b)

    const project = await loadGsProjectIdentity('p1')

    expect(from).toHaveBeenCalledWith('projects')
    expect(b.eq).toHaveBeenCalledWith('id', 'p1')
    expect(project).toEqual({ code: 'BB1', name: 'BlockB1_CPPTS' })
  })

  it('throws when RLS returns nothing, since a nameless file is not a report', async () => {
    from.mockImplementation(() => builder({ data: [] }))
    await expect(loadGsProjectIdentity('p9')).rejects.toThrow(/dự án/i)
  })

  it('throws when the read fails', async () => {
    from.mockImplementation(() => builder({ error: { message: 'mất kết nối' } }))
    await expect(loadGsProjectIdentity('p1')).rejects.toThrow('mất kết nối')
  })
})

describe('listDeckStates', () => {
  it('indexes a deck\'s states by work, then by bay', async () => {
    const stub = builder({
      data: [
        { cell_id: 'c1', work_id: 'wA', stage_id: 'a1', note: 'ẩm' },
        { cell_id: 'c1', work_id: 'wB', stage_id: null, note: '' },
        { cell_id: 'c2', work_id: 'wA', stage_id: null, note: null },
      ],
    })
    from.mockImplementationOnce(() => stub)

    const states = await listDeckStates('d1')

    expect(from).toHaveBeenCalledWith('cell_states')
    expect(stub.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(states).toEqual({
      wA: { c1: { stageId: 'a1', note: 'ẩm' }, c2: { stageId: null, note: '' } },
      wB: { c1: { stageId: null, note: '' } },
    })
  })

  it('throws when the read fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(listDeckStates('d1')).rejects.toThrow('permission denied')
  })
})

describe('listDeckWorks', () => {
  it('lists the bays works a deck is part of, in seq order, each with its coats for this deck', async () => {
    const wd = builder({
      data: [
        { work_id: 'wB', weight: '1', works: { id: 'wB', project_id: 'p1', seq: 2, name: 'Tháo giáo', kind: 'bays', weight: '0.35', counts: true, manual_progress: '0' } },
        { work_id: 'wA', weight: '0.6', works: { id: 'wA', project_id: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: '0.35', counts: true, manual_progress: '0' } },
      ],
    })
    const stages = builder({
      data: [
        { id: 'a2', work_id: 'wA', seq: 2, name: 'Coat 2', color: '#222222', weight: '0.5' },
        { id: 'b1', work_id: 'wB', seq: 1, name: 'Tháo giáo lửng', color: '#333333', weight: '1' },
        { id: 'a1', work_id: 'wA', seq: 1, name: 'Coat 1', color: '#111111', weight: '0.5' },
      ],
    })
    from.mockImplementationOnce(() => wd).mockImplementationOnce(() => stages)

    const works = await listDeckWorks('d1')

    expect(from.mock.calls.map((c) => c[0])).toEqual(['work_decks', 'deck_stages'])
    expect(wd.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(stages.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(works.map((w) => [w.work.id, w.weight, w.stages.map((s) => s.id)])).toEqual([
      ['wA', 0.6, ['a1', 'a2']],
      ['wB', 1, ['b1']],
    ])
    expect(works[0].work).toMatchObject({ name: 'Sơn', kind: 'bays', weight: 0.35, counts: true })
  })

  it('is empty for a deck in no work', async () => {
    from.mockImplementationOnce(() => builder({ data: [] })).mockImplementationOnce(() => builder({ data: [] }))
    expect(await listDeckWorks('d1')).toEqual([])
  })
})

describe('listProjectIndex', () => {
  it('builds each deck\'s work models from three reads, scoped to that deck', async () => {
    // works (+work_decks), decks (+cells, +deck_stages), cell_states: what the
    // tab labels need to read P_d for every deck of the project.
    const works = builder({
      data: [{ id: 'wA', project_id: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: '1', counts: true, manual_progress: '0',
        work_decks: [{ deck_id: 'd1', weight: '0.5' }, { deck_id: 'd2', weight: '0.5' }] }],
    })
    const decks = builder({
      data: [
        { id: 'd1', seq: 1, code: 'CD', name: 'Cellar', total_area_m2: '100', cells: [{ id: 'c1', code: 'R1C1', area_m2: '100' }],
          deck_stages: [{ id: 'a1', work_id: 'wA', deck_id: 'd1', seq: 1, name: 'Coat 1', color: '#111111', weight: '1' }] },
        { id: 'd2', seq: 2, code: 'MD', name: 'Main', total_area_m2: '100', cells: [], deck_stages: [] },
      ],
    })
    const states = builder({ data: [{ cell_id: 'c1', work_id: 'wA', deck_id: 'd1', stage_id: 'a1', note: '' }] })
    from.mockImplementationOnce(() => works).mockImplementationOnce(() => decks).mockImplementationOnce(() => states)

    const index = await listProjectIndex('p1', ['d1', 'd2'])

    expect(from.mock.calls.map((c) => c[0])).toEqual(['works', 'decks', 'cell_states'])
    expect(works.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(decks.in).toHaveBeenCalledWith('id', ['d1', 'd2'])
    expect(states.in).toHaveBeenCalledWith('deck_id', ['d1', 'd2'])
    // Each deck sees only itself inside every work, so summariseDeck reads the
    // right D and the right cells.
    expect(index.d1[0].decks.map((d) => d.deck.id)).toEqual(['d1'])
    expect(index.d1[0].decks[0].deck.cells[0]).toMatchObject({ id: 'c1', stageId: 'a1' })
    expect(index.d2[0].decks.map((d) => d.deck.id)).toEqual(['d2'])
    expect(index.d1[0].work.weight).toBe(1)
  })

  it('gives a deck with no works an entry, not a hole', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
      .mockImplementationOnce(() => builder({ data: [{ id: 'd9', seq: 1, code: 'X', name: 'X', total_area_m2: '0', cells: [], deck_stages: [] }] }))
      .mockImplementationOnce(() => builder({ data: [] }))
    expect(await listProjectIndex('p1', ['d9'])).toEqual({ d9: [] })
  })

  it('asks for nothing when there are no decks', async () => {
    expect(await listProjectIndex('p1', [])).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })
})

describe('setCellState', () => {
  it('upserts stage_id and note for the (bay, work), naming the deck, and nothing else', async () => {
    // The load-bearing assertion: cell_states_assert_gs_write rejects the
    // WHOLE write if any other column differs, and deck_id is what the RLS
    // policies and the realtime filter read. The key set is asserted, not
    // just the values.
    const stub = builder({ data: [{ cell_id: 'c1' }] })
    from.mockImplementationOnce(() => stub)

    await setCellState('c1', 'wA', 'd1', 's3', 'Bề mặt còn ẩm')

    expect(from).toHaveBeenCalledWith('cell_states')
    expect(stub.upsert).toHaveBeenCalledWith(
      { cell_id: 'c1', work_id: 'wA', deck_id: 'd1', stage_id: 's3', note: 'Bề mặt còn ẩm' },
      { onConflict: 'cell_id,work_id' },
    )
    const payload = (stub.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as object
    expect(Object.keys(payload).sort()).toEqual(['cell_id', 'deck_id', 'note', 'stage_id', 'work_id'])
    expect(stub.select).toHaveBeenCalledWith('cell_id')
  })

  it('sends an empty note by default, so a stage change clears the last one', async () => {
    const stub = builder({ data: [{ cell_id: 'c1' }] })
    from.mockImplementationOnce(() => stub)
    await setCellState('c1', 'wA', 'd1', null)
    expect(stub.upsert).toHaveBeenCalledWith(
      { cell_id: 'c1', work_id: 'wA', deck_id: 'd1', stage_id: null, note: '' },
      { onConflict: 'cell_id,work_id' },
    )
  })

  it('throws when the write matched nothing, rather than reporting a phantom success', async () => {
    // PostgREST answers a filtered-out upsert with no error and no rows.
    from.mockImplementationOnce(() => builder({ data: [] }))
    await expect(setCellState('c1', 'wA', 'd1', 's3')).rejects.toThrow(/not updated/)
  })

  it('throws on a refused write', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'only stage_id and note may be changed by a non-admin' } }))
    await expect(setCellState('c1', 'wA', 'd1', 's3')).rejects.toThrow('non-admin')
  })
})

describe('subscribeDeckStates', () => {
  it('subscribes to one deck\'s states, plus the deck\'s cell deletions, on its own channel', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)

    subscribeDeckStates('d1', { onStateChange: vi.fn(), onCellDelete: vi.fn(), onStatus: vi.fn() })

    expect(channel).toHaveBeenCalledWith('gs-states-d1')
    expect(ch.bindings.map((b) => [b.event, b.table])).toEqual([
      ['INSERT', 'cell_states'], ['UPDATE', 'cell_states'], ['DELETE', 'cells'],
    ])
    for (const binding of ch.bindings) expect(binding.filter).toBe('deck_id=eq.d1')
  })

  it('reports a state change as the (bay, work) it is about', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const onStateChange = vi.fn()

    subscribeDeckStates('d1', { onStateChange, onCellDelete: vi.fn(), onStatus: vi.fn() })
    ch.deliver('UPDATE', 'cell_states', {
      cell_id: 'c1', work_id: 'wA', deck_id: 'd1', stage_id: 's4', note: 'x',
      updated_at: '2026-09-02T00:00:00Z', updated_by: 'u1',
    })
    ch.deliver('INSERT', 'cell_states', { cell_id: 'c2', work_id: 'wA', deck_id: 'd1', stage_id: null, note: null })

    expect(onStateChange).toHaveBeenNthCalledWith(1, { cellId: 'c1', workId: 'wA', stageId: 's4', note: 'x' })
    expect(onStateChange).toHaveBeenNthCalledWith(2, { cellId: 'c2', workId: 'wA', stageId: null, note: '' })
  })

  it('reports a deleted cell by id, from the old record', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const onCellDelete = vi.fn()

    subscribeDeckStates('d1', { onStateChange: vi.fn(), onCellDelete, onStatus: vi.fn() })
    ch.deliver('DELETE', 'cells', { id: 'c7', deck_id: 'd1' })

    expect(onCellDelete).toHaveBeenCalledWith('c7')
  })

  it('maps the subscribe status and removes its own channel on unsubscribe', () => {
    const ch = fakeChannel()
    channel.mockReturnValue(ch)
    const onStatus = vi.fn<(s: GsRealtimeStatus) => void>()

    const unsubscribe = subscribeDeckStates('d1', { onStateChange: vi.fn(), onCellDelete: vi.fn(), onStatus })
    ch.setStatus('SUBSCRIBED')
    ch.setStatus('CHANNEL_ERROR')
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual(['subscribed', 'disconnected'])

    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(ch)
  })
})
