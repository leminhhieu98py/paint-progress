import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Stage } from '../domain/types'
import {
  createDeck, deleteDeck, duplicateDeck, getDrawingUrl, listCells, listDecks, listWorkStages,
  saveWorkStages, roundStageWeight, STAGE_WEIGHT_EPSILON, stagesRemovedBy,
  syncCells, updateDeckArea, uploadDrawing, zoneImpactOf,
} from './decksApi'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
const upload = vi.hoisted(() => vi.fn())
const createSignedUrl = vi.hoisted(() => vi.fn())
const remove = vi.hoisted(() => vi.fn())
const copy = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  supabase: { from, rpc, storage: { from: () => ({ upload, createSignedUrl, remove, copy }) } },
}))

function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'order', 'single']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
  upload.mockReset()
  createSignedUrl.mockReset()
  remove.mockReset()
  copy.mockReset()
})

describe('listDecks', () => {
  it('lists a project\'s decks with each one\'s cell count', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'd1', project_id: 'p1', seq: 1, name: 'Main Deck', code: 'MD',
        image_path: 'p1/d1.png', image_w: 2000, image_h: 1600,
        total_area_m2: '5258.50', area_source: 'guides',
        cells: [{ id: 'c1' }, { id: 'c2' }],
      }],
    }))

    const rows = await listDecks('p1')

    expect(rows).toEqual([{
      id: 'd1', projectId: 'p1', seq: 1, name: 'Main Deck', code: 'MD',
      imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600, drawingName: null, drawingPage: null,
      totalAreaM2: 5258.5, areaSource: 'guides', cellCount: 2,
    }])
  })

  it('defaults a deck with no drawing yet to null image fields and a zero cell count', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'd2', project_id: 'p1', seq: 2, name: 'Cellar', code: 'CD',
        image_path: null, image_w: null, image_h: null,
        total_area_m2: '0', area_source: 'prorated', cells: [],
      }],
    }))

    const [row] = await listDecks('p1')

    expect(row.imagePath).toBeNull()
    expect(row.imageW).toBeNull()
    expect(row.imageH).toBeNull()
    expect(row.cellCount).toBe(0)
  })

  it('scopes the query to the project and orders by seq', async () => {
    const stub = builder({ data: [] })
    from.mockImplementationOnce(() => stub)

    await listDecks('p1')

    expect(stub.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(stub.order).toHaveBeenCalledWith('seq')
  })

  it('throws when the query fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(listDecks('p1')).rejects.toThrow('permission denied')
  })
})

describe('createDeck', () => {
  it('inserts the deck under its project and seq, and returns its id', async () => {
    const stub = builder({ data: { id: 'd9' } })
    from.mockImplementationOnce(() => stub)
    from.mockImplementationOnce(() => builder({}))

    const id = await createDeck({ projectId: 'p1', seq: 3, name: 'Roof', code: 'RF' })

    expect(id).toBe('d9')
    expect(stub.insert).toHaveBeenCalledWith({
      project_id: 'p1', seq: 3, name: 'Roof', code: 'RF',
    })
  })

  it('leaves the new deck with no stages, so nobody inherits another deck\'s spec', async () => {
    // The seed used to write five coats named after one project's paint spec.
    // A deck whose real spec is three coats then had to have two DELETED --
    // a destructive edit, on a list the admin never asked for, before they had
    // declared anything. The empty list is caught in A3.2 instead, where it is
    // visible and where the save refuses it.
    from.mockImplementationOnce(() => builder({ data: { id: 'd9' } }))

    await createDeck({ projectId: 'p1', seq: 3, name: 'Roof', code: 'RF' })

    expect(from).not.toHaveBeenCalledWith('deck_stages')
  })

  it('throws when the insert fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'duplicate key value' } }))
    await expect(
      createDeck({ projectId: 'p1', seq: 1, name: 'X', code: 'X' }),
    ).rejects.toThrow('duplicate key value')
  })
})

describe('updateDeckArea', () => {
  it('updates the total area and its provenance together, on the right deck', async () => {
    const stub = builder({})
    from.mockImplementationOnce(() => stub)

    await updateDeckArea('d1', 1234.5, 'prorated')

    expect(stub.update).toHaveBeenCalledWith({ total_area_m2: 1234.5, area_source: 'prorated' })
    expect(stub.eq).toHaveBeenCalledWith('id', 'd1')
  })

  it('throws when the update fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(updateDeckArea('d1', 1, 'guides')).rejects.toThrow('permission denied')
  })
})

describe('listCells', () => {
  it('maps a cell\'s numeric fields, and carries no stage: that is per work now', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'c1', code: 'R1C1', x: '0.000000', y: '0.000000',
        w: '0.500000', h: '1.000000', area_m2: '100.00',
      }],
    }))

    const cells = await listCells('d1')

    expect(cells).toEqual([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100 },
    ])
  })

  it('scopes to the deck and orders by code', async () => {
    const stub = builder({ data: [] })
    from.mockImplementationOnce(() => stub)

    await listCells('d1')

    expect(stub.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(stub.order).toHaveBeenCalledWith('code')
  })

  it('throws when the query fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(listCells('d1')).rejects.toThrow('permission denied')
  })
})

describe('syncCells', () => {
  const persisted = (id: string, code: string, stageId: string | null) => ({
    id, code, x: 0, y: 0, w: 0.5, h: 1, area_m2: 100, stage_id: stageId,
  })

  it('upserts geometry only, never stage_id', async () => {
    // This is the assertion that protects recorded progress from the authoring
    // screen. PostgREST derives `do update set` from the payload keys, so a
    // stage_id key here -- even `stage_id: null` -- would overwrite the stage a
    // GS ticked on a cell the admin never meant to touch. Asserting the exact
    // payload object is what makes re-adding that key fail.
    const before = builder({ data: [persisted('c1', 'R1C1', 's1')] })
    const up = builder({ data: [{ id: 'c1', code: 'R1C1' }] })
    from.mockImplementationOnce(() => before).mockImplementationOnce(() => up)

    await syncCells('d1', [{ code: 'R1C1', x: 0.1, y: 0.2, w: 0.3, h: 0.4, areaM2: 120 }])

    expect(up.upsert).toHaveBeenCalledWith(
      [{ deck_id: 'd1', code: 'R1C1', x: 0.1, y: 0.2, w: 0.3, h: 0.4, area_m2: 120 }],
      { onConflict: 'deck_id,code' },
    )
    // Without the returned id the survivor's inherited zone links cannot be
    // written, so the select is part of the contract, not decoration.
    expect(up.select).toHaveBeenCalledWith('id, code')
  })

  it('deletes a code the new cell set no longer has, by id', async () => {
    const before = builder({
      data: [persisted('keep', 'R1C1', null), persisted('gone', 'R1C2', null)],
    })
    const up = builder({ data: [{ id: 'keep', code: 'R1C1' }] })
    const del = builder({})
    from
      .mockImplementationOnce(() => before)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => del)

    await syncCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 200 }])

    // By explicit id list. A `.eq('deck_id', deckId)` delete would take the
    // survivor's row with it and mint a new id for it, cascading its
    // cell_events away -- the defect this function replaced.
    expect(del.delete).toHaveBeenCalled()
    expect(del.in).toHaveBeenCalledWith('id', ['gone'])
  })

  it('does not issue a delete at all when nothing was removed', async () => {
    const before = builder({ data: [persisted('c1', 'R1C1', 's1')] })
    const up = builder({ data: [{ id: 'c1', code: 'R1C1' }] })
    const del = builder({})
    from
      .mockImplementationOnce(() => before)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => del)

    await syncCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100 }])

    // Exactly two calls: the snapshot read and the upsert. A third would mean a
    // `.in('id', [])` round trip that can only ever match nothing.
    expect(from).toHaveBeenCalledTimes(2)
    expect(del.delete).not.toHaveBeenCalled()
  })

  it('clears every cell without an upsert when the new set is empty', async () => {
    const before = builder({ data: [persisted('c1', 'R1C1', null)] })
    const del = builder({})
    from.mockImplementationOnce(() => before).mockImplementationOnce(() => del)

    await syncCells('d1', [])

    expect(del.in).toHaveBeenCalledWith('id', ['c1'])
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('re-links a merge survivor into a zone that held one of its sources', async () => {
    // Spec 8.3. The survivor's own links need no work -- its row was updated,
    // not replaced -- so the only rows to write are the absorbed source's.
    const order: string[] = []
    const before = builder({
      data: [persisted('surv', 'R1C1', null), persisted('src', 'R1C2', null)],
    })
    const zones = builder({ data: [{ zone_id: 'z1', cell_id: 'src' }] })
    ;(zones.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('snapshot')
      return zones
    })
    const up = builder({ data: [{ id: 'surv', code: 'R1C1' }] })
    const del = builder({})
    ;(del.delete as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('delete')
      return del
    })
    const relink = builder({})
    from
      .mockImplementationOnce(() => before)
      .mockImplementationOnce(() => zones)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => del)
      .mockImplementationOnce(() => relink)

    await syncCells(
      'd1',
      [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 200 }],
      { R1C1: ['R1C1', 'R1C2'] },
    )

    expect(zones.in).toHaveBeenCalledWith('cell_id', ['src'])
    // zone_cells cascades on cell_id: read the source's zones AFTER the delete
    // and there is nothing left to read.
    expect(order).toEqual(['snapshot', 'delete'])
    expect(relink.upsert).toHaveBeenCalledWith(
      [{ zone_id: 'z1', cell_id: 'surv' }],
      { onConflict: 'zone_id,cell_id', ignoreDuplicates: true },
    )
  })

  it('does not snapshot zone links when no survivor absorbs a vanishing code', async () => {
    // A plain delete or a mesh regeneration passes no inheritFrom, so the extra
    // zone_cells read would be a round trip whose result is never used.
    const before = builder({ data: [persisted('gone', 'R1C2', null)] })
    const up = builder({ data: [{ id: 'new', code: 'R1C1' }] })
    const del = builder({})
    from
      .mockImplementationOnce(() => before)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => del)

    await syncCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 1 }])

    expect(up.upsert).toHaveBeenCalled()
    expect(del.in).toHaveBeenCalledWith('id', ['gone'])
    expect(from).toHaveBeenCalledTimes(3)
  })

  it('throws when the upsert fails, and never reaches the delete', async () => {
    // Pinned to the upsert: with no inheritFrom it is the 2nd `from` call.
    // Injecting the error on the snapshot read instead would pass even if the
    // upsert error were never checked at all. The snapshot deliberately holds a
    // vanished code, so a 3rd call would prove the delete ran anyway.
    const before = builder({ data: [persisted('gone', 'R1C2', null)] })
    const del = builder({})
    from
      .mockImplementationOnce(() => before)
      .mockImplementationOnce(() => builder({ error: { message: 'upsert refused' } }))
      .mockImplementationOnce(() => del)

    await expect(
      syncCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 1 }]),
    ).rejects.toThrow('upsert refused')

    expect(from).toHaveBeenCalledTimes(2)
    expect(del.delete).not.toHaveBeenCalled()
  })

  it('throws when the delete fails', async () => {
    // Pinned to the delete, the 3rd call: snapshot, upsert, delete.
    const before = builder({ data: [persisted('gone', 'R1C2', null)] })
    const up = builder({ data: [{ id: 'new', code: 'R1C1' }] })
    from
      .mockImplementationOnce(() => before)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => builder({ error: { message: 'delete blocked' } }))

    await expect(
      syncCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 1 }]),
    ).rejects.toThrow('delete blocked')

    expect(from).toHaveBeenCalledTimes(3)
  })
})

describe('zoneImpactOf', () => {
  it('groups the affected cells by zone', async () => {
    from.mockImplementationOnce(() =>
      builder({
        data: [
          { cell_id: 'c1', cells: { code: 'R1C1' }, zones: { id: 'z1', name: 'Zone 1' } },
          { cell_id: 'c2', cells: { code: 'R1C2' }, zones: { id: 'z1', name: 'Zone 1' } },
          { cell_id: 'c3', cells: { code: 'R2C1' }, zones: { id: 'z2', name: 'Zone 2' } },
        ],
      }),
    )

    const impact = await zoneImpactOf('d1', ['c1', 'c2', 'c3'])

    expect(impact).toEqual([
      { zoneId: 'z1', zoneName: 'Zone 1', cellCodes: ['R1C1', 'R1C2'] },
      { zoneId: 'z2', zoneName: 'Zone 2', cellCodes: ['R2C1'] },
    ])
  })

  it('returns nothing when no cell belongs to a zone', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
    await expect(zoneImpactOf('d1', ['c1'])).resolves.toEqual([])
  })

  it('does not query at all for an empty selection', async () => {
    await expect(zoneImpactOf('d1', [])).resolves.toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('scopes the query to the given deck, not just the selected cell ids', async () => {
    // Cell ids are globally unique, so nothing about the response shape stops
    // a stale, cross-deck selection from returning another deck's zones --
    // that must be prevented by the query itself.
    //
    // This stub ignores .eq()/.in() arguments and always returns its canned
    // data regardless of what was asked for, so it cannot honestly prove that
    // PostgREST applies the deck filter server-side (a stub rigged to filter
    // client-side would just be testing the stub, not this function, and
    // would still pass if the .eq() call were deleted). What it CAN prove is
    // that the function issues the correct request: the embedded-filter
    // select naming cells!inner(..., deck_id), and .eq('cells.deck_id', ...)
    // called with this deck's id. Confirming PostgREST honours that filter
    // needs a live smoke test against a real Supabase instance, not a unit
    // test against a stub -- tracked separately.
    const stub = builder({ data: [] })
    from.mockImplementationOnce(() => stub)

    await zoneImpactOf('d1', ['c1'])

    expect(stub.select).toHaveBeenCalledWith('cell_id, cells!inner(code, deck_id), zones(id, name)')
    expect(stub.eq).toHaveBeenCalledWith('cells.deck_id', 'd1')
  })
})

describe('uploadDrawing', () => {
  it('writes to {projectId}/{deckId}.png and records the dimensions', async () => {
    upload.mockResolvedValue({ error: null })
    from.mockImplementationOnce(() => builder({}))

    const path = await uploadDrawing('d1', 'p1', new Blob(['x']), 1600, 1200)

    expect(path).toBe('p1/d1.png')
    expect(upload).toHaveBeenCalledWith('p1/d1.png', expect.anything(), {
      upsert: true,
      contentType: 'image/png',
    })
  })

  it('throws when the storage upload fails and does not touch the deck row', async () => {
    upload.mockResolvedValue({ error: { message: 'bucket not found' } })
    await expect(uploadDrawing('d1', 'p1', new Blob(['x']), 1, 1)).rejects.toThrow(
      'bucket not found',
    )
    expect(from).not.toHaveBeenCalled()
  })
})

describe('getDrawingUrl', () => {
  it('requests a signed URL, not a public one -- the bucket is private', async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/p1/d1.png' },
      error: null,
    })

    const url = await getDrawingUrl('p1/d1.png')

    // A public URL would look valid and 403 at fetch time -- nothing else in
    // this suite would notice, since the bucket really is private.
    expect(createSignedUrl).toHaveBeenCalledWith('p1/d1.png', 3600)
    expect(url).toBe('https://signed.example/p1/d1.png')
  })
})

// ---------------------------------------------------------------------------
// Paint stages. Moved here with their subjects when 0018 put a stage on a deck;
// the assertions are unchanged.
// ---------------------------------------------------------------------------

describe('saveWorkStages: weights, identity and write order', () => {
  const stage = (seq: number, weight: number) => ({
    id: `s${seq}`, seq, name: `S${seq}`, color: '#000000', weight,
  })

  it('rejects a weight set that does not sum to 1', async () => {
    await expect(saveWorkStages('w1', 'd1', [stage(1, 0.5), stage(2, 0.4)])).rejects.toThrow(
      /must sum to 1/,
    )
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a sum within the floating-point epsilon', async () => {
    from.mockImplementation(() => builder({}))
    // 0.1 * 3 + 0.7 is 0.9999999999999999 in IEEE754, not 1.
    await expect(
      saveWorkStages('w1', 'd1', [stage(1, 0.1), stage(2, 0.1), stage(3, 0.1), stage(4, 0.7)]),
    ).resolves.toBeUndefined()
  })

  it('accepts a sum just inside the epsilon', async () => {
    from.mockImplementation(() => builder({}))
    // 1 - 9e-6 is inside 1e-5, so this must be accepted.
    await expect(saveWorkStages('w1', 'd1', [stage(1, 0.5), stage(2, 0.5 - 9e-6)])).resolves.toBeUndefined()
  })

  it('rejects a sum just outside the epsilon', async () => {
    // 1 - 1.1e-5 is outside, so this must be rejected. Pinned because an
    // off-by-one in the epsilon or a flipped operator would otherwise pass.
    await expect(saveWorkStages('w1', 'd1', [stage(1, 0.5), stage(2, 0.5 - 1.1e-5)])).rejects.toThrow(
      /must sum to 1/,
    )
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts the three-way split as numeric(6,5) actually stores it', async () => {
    // The defect the epsilon was widened for. 0.333333 x2 + 0.334334 sums to
    // exactly 1 and passed at 1e-6, but weight is numeric(6,5): Postgres stores
    // 0.33333 three times, so the reloaded config totals 0.99999 and failed the
    // very check it had just passed -- the red banner appeared and Save
    // disabled on a configuration that had saved successfully seconds earlier.
    // These are the stored values, so this is the reload that used to fail.
    from.mockImplementation(() => builder({}))
    const third = roundStageWeight(0.333333)
    expect(third).toBe(0.33333)
    expect(Math.abs(1 - third * 3)).toBeGreaterThan(1e-6)
    await expect(
      saveWorkStages('w1', 'd1', [stage(1, third), stage(2, third), stage(3, third)]),
    ).resolves.toBeUndefined()
  })

  it('exposes the epsilon it uses', () => {
    expect(STAGE_WEIGHT_EPSILON).toBe(1e-5)
  })

  it('rejects duplicate seq values', async () => {
    await expect(
      saveWorkStages('w1', 'd1', [stage(1, 0.5), { ...stage(1, 0.5), id: 's2' }]),
    ).rejects.toThrow(/seq/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects duplicate ids', async () => {
    // Two rows claiming one id would make the upsert's `do update` touch the
    // same row twice ("ON CONFLICT DO UPDATE command cannot affect row a second
    // time"), and would mean two stages sharing one set of recorded cells.
    // Rejected before any write, with a message about ids rather than seqs.
    await expect(
      saveWorkStages('w1', 'd1', [stage(1, 0.5), { ...stage(2, 0.5), id: 's1' }]),
    ).rejects.toThrow(/ids must be unique/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects an empty stage list', async () => {
    await expect(saveWorkStages('w1', 'd1', [])).rejects.toThrow(/at least one stage/)
    expect(from).not.toHaveBeenCalled()
  })

  /** The persisted rows saveWorkStages reads back before diffing, PostgREST-shaped. */
  const persisted = (rows: { id: string; seq: number; weight: number; name?: string }[]) =>
    builder({
      data: rows.map((r) => ({
        id: r.id,
        seq: r.seq,
        name: r.name ?? `S${r.seq}`,
        color: '#000000',
        weight: String(r.weight),
      })),
    })

  /** The exact text Postgres raises for (deck_id, seq) -- see 0001 and 0012. */
  const DUPLICATE_SEQ =
    'duplicate key value violates unique constraint "deck_stages_work_id_deck_id_seq_key"'

  type StageRow = {
    id: string
    work_id: string
    deck_id: string
    seq: number
    name: string
    color: string
    weight: number
  }

  /**
   * A stand-in for `deck_stages` that ENFORCES `unique (work_id, deck_id, seq)`.
   *
   * This exists because three separate layers of evidence -- a payload
   * assertion, a stand-in that applied the upsert, and a verify_schema check --
   * all passed while removing any stage but the last one failed outright against
   * a real Postgres. None of them modelled a constraint, so none of them could
   * see a write that only a constraint rejects. A stand-in that accepts
   * everything cannot fail the test whose name promises the write works.
   *
   * What is modelled, and why each part is load-bearing:
   *
   *   - Each `from()` chain is ONE statement in ONE transaction, exactly as each
   *     PostgREST round trip is. That is why the constraint catches the defect:
   *     the collision has to survive to the end of a round trip, and under an
   *     upsert-then-delete order it does.
   *   - The unique check runs at the END of a statement, not row by row --
   *     0012 made the constraint `deferrable initially deferred`, so a reorder
   *     swapping two seqs inside one statement is legal and must stay legal.
   *     Row-by-row checking here would fail the reorder and misrepresent 0012.
   *   - A violation rolls the whole statement back and returns the error
   *     PostgREST would, so a test can assert that nothing was written.
   *   - The upsert matches rows by whatever conflict target the CODE names, not
   *     by a target this helper assumes. Keyed on (deck_id, seq) it
   *     reproduces B1's identity defect; keyed on id it does not.
   *   - `.eq()` filters are honoured on delete, so a `.eq('deck_id', ...)`
   *     delete really does wipe the project here instead of quietly passing.
   *
   * Not modelled: two payload rows sharing one id ("ON CONFLICT DO UPDATE
   * command cannot affect row a second time"). saveWorkStages rejects that before
   * any write, and 'rejects duplicate ids' above covers it, so modelling it here
   * would only add an unreachable branch.
   */
  function stageTable(initial: StageRow[]) {
    let rows = initial.map((r) => ({ ...r }))
    /** Which statements reached the table, in order. */
    const statements: string[] = []

    const duplicateSeq = (candidate: StageRow[]): boolean => {
      const seen = new Set<string>()
      for (const r of candidate) {
        const key = `${r.work_id}|${r.deck_id}|${r.seq}`
        if (seen.has(key)) return true
        seen.add(key)
      }
      return false
    }

    const from = () => {
      let op: 'select' | 'delete' | 'upsert' | null = null
      let payload: StageRow[] = []
      let conflictTarget: string[] = []
      let ids: string[] | null = null
      const filters: [string, unknown][] = []

      const run = (): { data: unknown; error: unknown } => {
        statements.push(op ?? 'none')
        const matches = (r: StageRow) =>
          filters.every(([col, value]) => (r as unknown as Record<string, unknown>)[col] === value)

        if (op === 'delete') {
          rows = rows.filter((r) => !(matches(r) && (ids === null || ids.includes(r.id))))
          return { data: null, error: null }
        }
        if (op === 'upsert') {
          const before = rows.map((r) => ({ ...r }))
          const keyOf = (r: Record<string, unknown>) =>
            conflictTarget.map((k) => String(r[k])).join('|')
          for (const incoming of payload) {
            const existing = rows.find((r) => keyOf(r) === keyOf(incoming))
            if (existing) Object.assign(existing, incoming)
            else rows.push({ ...incoming })
          }
          if (duplicateSeq(rows)) {
            // Statement-level rollback, the way Postgres would.
            rows = before
            return { data: null, error: { message: DUPLICATE_SEQ } }
          }
          return { data: null, error: null }
        }
        // select: PostgREST hands numerics back as strings.
        return {
          data: rows
            .filter(matches)
            .slice()
            .sort((a, b) => a.seq - b.seq)
            .map((r) => ({
              id: r.id, seq: r.seq, name: r.name, color: r.color, weight: String(r.weight),
            })),
          error: null,
        }
      }

      const b: Record<string, unknown> = {}
      b.select = vi.fn(() => { op = 'select'; return b })
      b.delete = vi.fn(() => { op = 'delete'; return b })
      b.upsert = vi.fn((p: StageRow[], opts: { onConflict: string }) => {
        op = 'upsert'
        payload = p
        conflictTarget = opts.onConflict.split(',')
        return b
      })
      b.eq = vi.fn((col: string, value: unknown) => { filters.push([col, value]); return b })
      b.in = vi.fn((_col: string, values: string[]) => { ids = values; return b })
      b.order = vi.fn(() => b)
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve)
      return b
    }

    return { rows: () => rows, statements, from }
  }

  /** Five stages seq 1..5 under (w1, d1), the shape the default work seeds. */
  const fiveStages = (): StageRow[] => [
    { id: 'coat1', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.2 },
    { id: 'coat2', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.2 },
    { id: 'coat3', work_id: 'w1', deck_id: 'd1', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.2 },
    { id: 'coat4', work_id: 'w1', deck_id: 'd1', seq: 4, name: 'Coat 4', color: '#1677ff', weight: 0.2 },
    { id: 'coat5', work_id: 'w1', deck_id: 'd1', seq: 5, name: 'Coat 5', color: '#722ed1', weight: 0.2 },
  ]

  it('removes a middle stage and renumbers the survivors past the seq it vacated', async () => {
    // The C1 regression, at the only layer that could ever have caught it.
    //
    // Default 5-stage project. Linh removes "Coat 2" (seq 2) and the panel
    // renumbers the survivors 1..4, so Coat 3 moves INTO seq 2 -- the seq the
    // row being removed still holds. Upserting before deleting put two rows at
    // seq 2 and Postgres rejected the statement outright: nothing was deleted,
    // nothing was renamed, and only the LAST stage could ever be removed.
    const table = stageTable(fiveStages())
    from.mockImplementation(table.from)

    await saveWorkStages('w1', 'd1', [
      { id: 'coat1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
      { id: 'coat3', seq: 2, name: 'Coat 3', color: '#52c41a', weight: 0.25 },
      { id: 'coat4', seq: 3, name: 'Coat 4', color: '#1677ff', weight: 0.25 },
      { id: 'coat5', seq: 4, name: 'Coat 5', color: '#722ed1', weight: 0.25 },
    ])

    // Four rows, renumbered 1..4 with no gap and no tie, each name still on its
    // own id.
    expect(table.rows().map((r) => [r.seq, r.id, r.name])).toEqual([
      [1, 'coat1', 'Blast + Coat 1'],
      [2, 'coat3', 'Coat 3'],
      [3, 'coat4', 'Coat 4'],
      [4, 'coat5', 'Coat 5'],
    ])
    // And the removal actually happened -- this is not passing because the
    // delete was skipped.
    expect(table.rows().some((r) => r.id === 'coat2')).toBe(false)
    // The order is the fix. Reversing these two makes the upsert collide.
    expect(table.statements).toEqual(['select', 'delete', 'upsert'])
  })

  it('leaves a cell recorded at a surviving stage pointing at that same stage after a middle removal', async () => {
    // The consequence on the cell, which is where the customer sees the damage.
    // cells.stage_id points at a ROW, so what matters is not that the write
    // succeeded but that the row it names still means Coat 3 afterwards -- now
    // second in the paint sequence rather than third.
    const table = stageTable(fiveStages())
    from.mockImplementation(table.from)
    const cell = { code: 'R1C1', stage_id: 'coat3' }

    await saveWorkStages('w1', 'd1', [
      { id: 'coat1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
      { id: 'coat3', seq: 2, name: 'Coat 3', color: '#52c41a', weight: 0.25 },
      { id: 'coat4', seq: 3, name: 'Coat 4', color: '#1677ff', weight: 0.25 },
      { id: 'coat5', seq: 4, name: 'Coat 5', color: '#722ed1', weight: 0.25 },
    ])

    const recordedAt = table.rows().find((r) => r.id === cell.stage_id)
    expect(recordedAt?.name).toBe('Coat 3')
    expect(recordedAt?.seq).toBe(2)
  })

  it('removes the last stage, the one case the broken order could still do', async () => {
    // Pinned separately because it is the case that used to work: removing the
    // last stage shifts no survivor's seq, so it never collided. A fix that
    // somehow only handled the middle would still have to keep this passing.
    const table = stageTable(fiveStages())
    from.mockImplementation(table.from)

    await saveWorkStages('w1', 'd1', [
      { id: 'coat1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
      { id: 'coat2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.25 },
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.25 },
      { id: 'coat4', seq: 4, name: 'Coat 4', color: '#1677ff', weight: 0.25 },
    ])

    expect(table.rows().map((r) => r.id)).toEqual(['coat1', 'coat2', 'coat3', 'coat4'])
  })

  it('accepts a reorder that swaps two seqs inside one statement', async () => {
    // What 0012's deferral buys, asserted against a table that actually
    // enforces the constraint: after the first payload row is written two rows
    // momentarily hold seq 1, and an IMMEDIATE constraint rejects a statement
    // whose final state is perfectly unique. Nothing is removed, so this is the
    // half of the write order that must survive the C1 fix untouched.
    const table = stageTable([
      { id: 'coat1', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 'coat2', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
    ])
    from.mockImplementation(table.from)
    const cell = { code: 'R1C1', stage_id: 'coat1' }

    await saveWorkStages('w1', 'd1', [
      { id: 'coat2', seq: 1, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
      { id: 'coat1', seq: 2, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
    ])

    // The cell is still recorded at Coat 1 -- the stage it was recorded at --
    // and NOT at whatever stage now occupies the seq Coat 1 used to hold.
    const recordedAt = table.rows().find((r) => r.id === cell.stage_id)
    expect(recordedAt?.name).toBe('Coat 1')
    expect(recordedAt?.seq).toBe(2)
    expect(table.rows().find((r) => r.seq === 1)?.name).toBe('Coat 2')
    // Two rows in, two rows out: the reorder must not have inserted anything,
    // and with nothing removed there must have been no delete round trip.
    expect(table.rows()).toHaveLength(2)
    expect(table.statements).toEqual(['select', 'upsert'])
  })

  it('has a stand-in that really does reject a colliding write, and roll it back', async () => {
    // A self-check on the helper above, driven directly rather than through
    // saveWorkStages, and it is not ceremony: the reason C1 shipped is that every
    // layer of evidence stood in for Postgres with something that accepts
    // anything. If the enforcement here is ever weakened, the four tests above
    // go on passing while meaning nothing -- so the enforcement itself is
    // pinned, in the two ways it has to behave.
    //
    // Driven directly for a second reason: once the delete goes first,
    // saveWorkStages CANNOT construct a colliding write. Everything absent from the
    // draft is removed before the survivors are renumbered, and the draft's own
    // seqs are checked for uniqueness before any statement is issued. There is
    // deliberately no test claiming saveWorkStages produces a duplicate key, because
    // it no longer can -- which is also why StageConfigPanel's translation of
    // that message is a last line of defence rather than a routine path.
    const table = stageTable([
      { id: 'coat1', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 'coat2', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
    ])

    /** One upsert statement against the stand-in, as PostgREST would answer it. */
    const upsert = (payload: StageRow[]) =>
      (table.from() as unknown as {
        upsert: (
          p: StageRow[],
          o: { onConflict: string },
        ) => PromiseLike<{ error: { message: string } | null }>
      }).upsert(payload, { onConflict: 'id' })

    // Moving coat1 onto the seq coat2 still holds: the exact shape of the write
    // saveWorkStages issued when it upserted before deleting.
    const collide = await upsert([
      { id: 'coat1', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
    ])
    expect(collide.error?.message).toBe(DUPLICATE_SEQ)
    // Rolled back whole, the way a rejected statement is.
    expect(table.rows().map((r) => [r.id, r.seq])).toEqual([['coat1', 1], ['coat2', 2]])

    // And the other half: the check is DEFERRED to the end of the statement, so
    // a swap that passes through a momentary tie is accepted. A row-by-row
    // check here would reject the reorder 0012 exists to allow.
    const swap = await upsert([
      { id: 'coat1', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 'coat2', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
    ])
    expect(swap.error).toBeNull()
    expect(table.rows().map((r) => [r.id, r.seq])).toEqual([['coat1', 2], ['coat2', 1]])
  })

  it('upserts on the id, carrying every row\'s own id in the payload', async () => {
    // The whole point of the rewrite. Identity is the id, so a rename is an
    // UPDATE of the row the admin renamed -- not of whatever row happens to sit
    // at that seq. seq rides along as an ordinary column: display order.
    const read = persisted([{ id: 's1', seq: 1, weight: 0.5 }, { id: 's2', seq: 2, weight: 0.5 }])
    const up = builder({})
    from.mockImplementationOnce(() => read).mockImplementationOnce(() => up)

    await saveWorkStages('w1', 'd1', [
      { id: 's1', seq: 1, name: 'Renamed', color: '#111111', weight: 0.5 },
      { id: 's2', seq: 2, name: 'S2', color: '#000000', weight: 0.5 },
    ])

    expect(up.upsert).toHaveBeenCalledWith(
      [
        { id: 's1', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'Renamed', color: '#111111', weight: 0.5 },
        { id: 's2', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'S2', color: '#000000', weight: 0.5 },
      ],
      { onConflict: 'id' },
    )
  })

  it('preserves the id and issues no delete when a stage is only renamed', async () => {
    // The stage row survives, so its id survives, so its zones and its cells'
    // stage_id survive. Exactly two round trips: the snapshot read and the
    // upsert. A third would mean something was being deleted.
    const read = persisted([{ id: 's1', seq: 1, weight: 0.5 }, { id: 's2', seq: 2, weight: 0.5 }])
    const up = builder({})
    const del = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => del)

    await saveWorkStages('w1', 'd1', [
      { id: 's1', seq: 1, name: 'Renamed', color: '#111111', weight: 0.5 },
      { id: 's2', seq: 2, name: 'S2', color: '#000000', weight: 0.5 },
    ])

    const payload = (up.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as { id: string }[]
    expect(payload.map((r) => r.id)).toEqual(['s1', 's2'])
    expect(from).toHaveBeenCalledTimes(2)
    expect(del.delete).not.toHaveBeenCalled()
  })

  it('issues no delete when only a weight changes', async () => {
    // Same guarantee on the other edit an admin makes constantly. Weights move
    // between existing rows, so nothing disappears.
    const read = persisted([{ id: 's1', seq: 1, weight: 0.5 }, { id: 's2', seq: 2, weight: 0.5 }])
    const up = builder({})
    const del = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => del)

    await saveWorkStages('w1', 'd1', [
      { id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 0.7 },
      { id: 's2', seq: 2, name: 'S2', color: '#000000', weight: 0.3 },
    ])

    expect(from).toHaveBeenCalledTimes(2)
    expect(del.delete).not.toHaveBeenCalled()
  })

  it('keeps every id across a reorder, and deletes nothing', async () => {
    // A reorder is now a pure seq rewrite: the same three rows come back in a
    // different display order. Under the seq-keyed upsert the payload carried no
    // ids at all, and each seq's row was rewritten in place -- so the ids stayed
    // put while the names moved between them.
    const before = [
      { id: 's1', seq: 1, weight: 0.4, name: 'Blast + Coat 1' },
      { id: 's2', seq: 2, weight: 0.3, name: 'Coat 2' },
      { id: 's3', seq: 3, weight: 0.3, name: 'Coat 3' },
    ]
    const read = persisted(before)
    const up = builder({})
    const del = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => del)

    // Coat 3 moves up one, exactly as the panel's "Lên" produces it.
    await saveWorkStages('w1', 'd1', [
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#000000', weight: 0.4 },
      { id: 's3', seq: 2, name: 'Coat 3', color: '#000000', weight: 0.3 },
      { id: 's2', seq: 3, name: 'Coat 2', color: '#000000', weight: 0.3 },
    ])

    const payload = (up.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      id: string
      seq: number
      name: string
    }[]
    // Every pre-reorder id is still present, each still attached to its own
    // name, and only the seq differs.
    expect(payload.map((r) => r.id).sort()).toEqual(before.map((b) => b.id).sort())
    expect(payload.map((r) => [r.id, r.name, r.seq])).toEqual([
      ['s1', 'Blast + Coat 1', 1],
      ['s3', 'Coat 3', 2],
      ['s2', 'Coat 2', 3],
    ])
    expect(from).toHaveBeenCalledTimes(2)
    expect(del.delete).not.toHaveBeenCalled()
  })

  it('deletes exactly the id that disappeared, and the survivors keep theirs', async () => {
    // Removing the MIDDLE of three, which is where a seq-keyed diff went wrong:
    // the panel renumbers 1..n, so the seq that vanishes is 3 and by seq this
    // deleted s3 -- the last stage -- while the admin had asked for the middle
    // one. By id it deletes s2, and s1 and s3 survive with their ids intact even
    // though s3's seq is renumbered from 3 to 2.
    const read = persisted([
      { id: 's1', seq: 1, weight: 0.4 },
      { id: 's2', seq: 2, weight: 0.3 },
      { id: 's3', seq: 3, weight: 0.3 },
    ])
    // Read, then DELETE, then upsert -- the order saveWorkStages issues them in, and
    // the reason it does: see the write-order paragraph in projectsApi.ts.
    const del = builder({})
    const up = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => del)
      .mockImplementationOnce(() => up)

    await saveWorkStages('w1', 'd1', [
      { id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 0.5 },
      { id: 's3', seq: 2, name: 'S3', color: '#000000', weight: 0.5 },
    ])

    const payload = (up.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      id: string
      seq: number
    }[]
    expect(payload.map((r) => [r.id, r.seq])).toEqual([
      ['s1', 1],
      ['s3', 2],
    ])
    expect(del.delete).toHaveBeenCalled()
    expect(del.in).toHaveBeenCalledWith('id', ['s2'])
    // By id, never by project. A `.eq('deck_id', 'd1')` delete is the defect
    // this rewrite exists to remove, and it would still satisfy the assertion
    // above if both were issued.
    expect(del.eq).not.toHaveBeenCalled()
  })

  it('throws when the delete fails, and never reaches the upsert', async () => {
    // The delete is first now, so it is the statement that can strand the save
    // before anything else runs. Nothing is written at all in that case.
    const read = persisted([{ id: 's1', seq: 1, weight: 0.5 }, { id: 's2', seq: 2, weight: 0.5 }])
    const up = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => builder({ error: { message: 'delete blocked' } }))
      .mockImplementationOnce(() => up)

    await expect(
      saveWorkStages('w1', 'd1', [{ id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 1 }]),
    ).rejects.toThrow('delete blocked')

    expect(from).toHaveBeenCalledTimes(2)
    expect(up.upsert).not.toHaveBeenCalled()
  })

  it('throws when the upsert fails after the removal already committed', async () => {
    // The half-failed case the write order deliberately chooses. The removal is
    // already gone and the survivors were never renumbered, so the project is
    // left with a GAP in seq plus Σ weight ≠ 1. computeDeckProgress compares
    // stageSeqOf(...) >= stage.seq over a sorted copy, so a gap changes no
    // percentage; the admin fixes the weights the panel is already refusing to
    // save. A tie is what would corrupt every percentage, and this order cannot
    // produce one.
    const read = persisted([{ id: 's1', seq: 1, weight: 0.5 }, { id: 's2', seq: 2, weight: 0.5 }])
    const del = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => del)
      .mockImplementationOnce(() => builder({ error: { message: 'upsert refused' } }))

    await expect(
      saveWorkStages('w1', 'd1', [{ id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 1 }]),
    ).rejects.toThrow('upsert refused')

    expect(from).toHaveBeenCalledTimes(3)
    expect(del.in).toHaveBeenCalledWith('id', ['s2'])
  })

  it('throws when the snapshot read fails, before writing anything', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'network down' } }))

    await expect(
      saveWorkStages('w1', 'd1', [{ id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 1 }]),
    ).rejects.toThrow('network down')

    expect(from).toHaveBeenCalledTimes(1)
  })
})

describe('stagesRemovedBy', () => {
  const stageAt = (id: string, seq: number, name = `S${seq}`): Stage => ({
    id, seq, name, color: '#000000', weight: 0.5,
  })

  it('names nothing when every id survives, however the seqs moved', () => {
    // A reorder plus a rename: both rows survive, at swapped seqs, one of them
    // under a new name. Nothing is being deleted, so nothing is named -- which
    // is what makes the panel save a reorder with no dialog.
    expect(
      stagesRemovedBy(
        [stageAt('s1', 1, 'A'), stageAt('s2', 2, 'B')],
        [stageAt('s2', 1, 'B'), stageAt('s1', 2, 'Renamed')],
      ),
    ).toEqual([])
  })

  it('names the stage the admin actually removed, not the seq that vanished', () => {
    // The defect a seq-keyed diff had, in one assertion. The panel renumbers
    // 1..n, so removing the middle of three leaves seqs 1 and 2 and the seq that
    // disappears is 3: by seq this named C, a row that survives, while the
    // database deleted B. It carries the PERSISTED name, because the removed row
    // is no longer in the draft to have a name of its own.
    expect(
      stagesRemovedBy(
        [stageAt('s1', 1, 'A'), stageAt('s2', 2, 'B'), stageAt('s3', 3, 'C')],
        [stageAt('s1', 1, 'A'), stageAt('s3', 2, 'C')],
      ),
    ).toEqual([stageAt('s2', 2, 'B')])
  })

  it('names nothing for a stage the admin has just added', () => {
    // A brand new row carries a client-minted id that no persisted row holds.
    // The diff runs the other way round, so it must stay empty rather than
    // reporting the whole persisted list as removed.
    expect(stagesRemovedBy([], [stageAt('fresh-uuid', 1, 'S1')])).toEqual([])
  })
})

describe('roundStageWeight', () => {
  it('clamps to the five decimals numeric(6,5) can hold', () => {
    expect(roundStageWeight(0.333333)).toBe(0.33333)
    expect(roundStageWeight(0.333338)).toBe(0.33334)
  })

  it('leaves a value already within scale 5 alone', () => {
    // Rounding must not perturb the ordinary case: 0.15 has to stay 0.15, not
    // become 0.15000000000000002.
    expect(roundStageWeight(0.15)).toBe(0.15)
    expect(roundStageWeight(0.33333)).toBe(0.33333)
    expect(roundStageWeight(1)).toBe(1)
    expect(roundStageWeight(0)).toBe(0)
  })
})

describe('deleteDeck', () => {
  it('deletes the row first, then the drawing it pointed at', async () => {
    // This order, and not the other: a row that outlives its PNG is a deck
    // with a broken drawing on every screen; a PNG that outlives its row is a
    // few megabytes nobody can reach. The cascade (0001/0003/0018) takes the
    // cells, zones, guides, stages and events with the row.
    const b = builder({ data: null })
    from.mockImplementationOnce(() => b)
    remove.mockResolvedValue({ data: [{ name: 'p1/d1.png' }], error: null })

    const result = await deleteDeck({ id: 'd1', imagePath: 'p1/d1.png' })

    expect(from).toHaveBeenCalledWith('decks')
    expect((b.delete as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    expect(b.eq).toHaveBeenCalledWith('id', 'd1')
    expect(remove).toHaveBeenCalledWith(['p1/d1.png'])
    const deleteOrder = (b.delete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(remove.mock.invocationCallOrder[0]).toBeGreaterThan(deleteOrder)
    expect(result).toEqual({ drawingRemoved: true })
  })

  it('never touches storage when the row delete is refused', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(deleteDeck({ id: 'd1', imagePath: 'p1/d1.png' })).rejects.toThrow('permission denied')
    expect(remove).not.toHaveBeenCalled()
  })

  it('reports a drawing it could not remove instead of failing a delete that has happened', async () => {
    from.mockImplementationOnce(() => builder({ data: null }))
    remove.mockResolvedValue({ data: null, error: { message: 'storage down' } })

    await expect(deleteDeck({ id: 'd1', imagePath: 'p1/d1.png' }))
      .resolves.toEqual({ drawingRemoved: false })
  })

  it('has nothing to remove for a deck that never had a drawing', async () => {
    from.mockImplementationOnce(() => builder({ data: null }))
    await expect(deleteDeck({ id: 'd1', imagePath: null })).resolves.toEqual({ drawingRemoved: true })
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('listWorkStages / saveWorkStages', () => {
  const stage = (seq: number, weight: number) => ({
    id: `s${seq}`, seq, name: `S${seq}`, color: '#000000', weight,
  })

  it('reads the coats of one (work, deck) in seq order', async () => {
    const b = builder({
      data: [{ id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.25' }],
    })
    from.mockImplementationOnce(() => b)

    const stages = await listWorkStages('w1', 'd1')

    expect(from).toHaveBeenCalledWith('deck_stages')
    expect(b.eq).toHaveBeenCalledWith('work_id', 'w1')
    expect(b.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(b.order).toHaveBeenCalledWith('seq')
    expect(stages).toEqual([{ id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 }])
  })

  it('upserts every coat with both keys of the (work, deck) it belongs to', async () => {
    // Since 0024 a stage row needs its work_id; without it the insert fails on
    // NOT NULL, and with the wrong one the coat lands in another discipline.
    from.mockImplementationOnce(() => builder({ data: [] }))
    const up = builder({ data: null })
    from.mockImplementationOnce(() => up)

    await saveWorkStages('w1', 'd1', [stage(1, 0.5), stage(2, 0.5)])

    expect(up.upsert).toHaveBeenCalledWith(
      [
        { id: 's1', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'S1', color: '#000000', weight: 0.5 },
        { id: 's2', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'S2', color: '#000000', weight: 0.5 },
      ],
      { onConflict: 'id' },
    )
  })

  it('deletes the coats removed from this (work, deck) before upserting, and only those', async () => {
    from.mockImplementationOnce(() => builder({
      data: [
        { id: 's1', seq: 1, name: 'S1', color: '#000000', weight: '0.5' },
        { id: 's9', seq: 2, name: 'Old', color: '#000000', weight: '0.5' },
      ],
    }))
    const del = builder({ data: null })
    const up = builder({ data: null })
    from.mockImplementationOnce(() => del).mockImplementationOnce(() => up)

    await saveWorkStages('w1', 'd1', [stage(1, 1)])

    expect(del.delete).toHaveBeenCalled()
    expect(del.in).toHaveBeenCalledWith('id', ['s9'])
  })

  it('applies the same weight, seq and id rules as before', async () => {
    await expect(saveWorkStages('w1', 'd1', [stage(1, 0.5), stage(2, 0.4)])).rejects.toThrow(/must sum to 1/)
    await expect(saveWorkStages('w1', 'd1', [])).rejects.toThrow(/at least one stage/)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('duplicateDeck (0029)', () => {
  const SRC = { id: 'd1', projectId: 'p1', imagePath: 'p1/d1.png' }

  it('copies the row through the function, then the drawing file, then points the copy at it', async () => {
    rpc.mockResolvedValue({ data: 'd9', error: null })
    copy.mockResolvedValue({ data: { path: 'p1/d9.png' }, error: null })
    const update = builder({})
    from.mockImplementationOnce(() => update)

    const result = await duplicateDeck(SRC, { name: 'Cellar Deck (bản sao)', code: 'CD-2' })

    expect(rpc).toHaveBeenCalledWith('duplicate_deck', {
      src: 'd1', new_name: 'Cellar Deck (bản sao)', new_code: 'CD-2',
    })
    // A copy, never the same path: deleteDeck removes the file its row names.
    expect(copy).toHaveBeenCalledWith('p1/d1.png', 'p1/d9.png')
    expect(from).toHaveBeenCalledWith('decks')
    expect(update.update).toHaveBeenCalledWith({ image_path: 'p1/d9.png' })
    expect(update.eq).toHaveBeenCalledWith('id', 'd9')
    expect(result).toEqual({ deckId: 'd9', drawingCopied: true })
  })

  it('skips the file when the source has no drawing', async () => {
    rpc.mockResolvedValue({ data: 'd9', error: null })
    const result = await duplicateDeck({ ...SRC, imagePath: null }, { name: 'x', code: 'X' })
    expect(copy).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
    expect(result).toEqual({ deckId: 'd9', drawingCopied: true })
  })

  it('keeps the copied deck and says so when the file copy fails', async () => {
    // The deck is whole without its picture (guides, cells, area all landed);
    // the admin uploads the drawing the ordinary way. Failing the whole
    // duplicate here would leave a deck row behind anyway.
    rpc.mockResolvedValue({ data: 'd9', error: null })
    copy.mockResolvedValue({ data: null, error: { message: 'storage down' } })
    const result = await duplicateDeck(SRC, { name: 'x', code: 'X' })
    expect(from).not.toHaveBeenCalled()
    expect(result).toEqual({ deckId: 'd9', drawingCopied: false })
  })

  it('surfaces a refused copy', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'only an admin may duplicate a deck' } })
    await expect(duplicateDeck(SRC, { name: 'x', code: 'X' })).rejects.toThrow(/admin/)
    expect(copy).not.toHaveBeenCalled()
  })
})
