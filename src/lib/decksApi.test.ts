import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDrawingUrl, replaceCells, uploadDrawing, zoneImpactOf } from './decksApi'

const from = vi.hoisted(() => vi.fn())
const upload = vi.hoisted(() => vi.fn())
const createSignedUrl = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  supabase: { from, storage: { from: () => ({ upload, createSignedUrl }) } },
}))

function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

beforeEach(() => {
  from.mockReset()
  upload.mockReset()
  createSignedUrl.mockReset()
})

describe('replaceCells', () => {
  it('carries stage_id and zone membership across by cell code', async () => {
    // A naive delete-and-reinsert cascades zone_cells and drops stage_id for
    // EVERY cell on the deck, including ones the edit never touched. Code is
    // the stable identity across a regeneration.
    const existing = builder({
      data: [{ id: 'old1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, area_m2: 100, stage_id: 's1' }],
    })
    const links = builder({ data: [{ zone_id: 'z1', cells: { code: 'R1C1', deck_id: 'd1' } }] })
    const del = builder({})
    const ins = builder({ data: [{ id: 'new1', code: 'R1C1' }] })
    const relink = builder({})
    from
      .mockImplementationOnce(() => existing)
      .mockImplementationOnce(() => links)
      .mockImplementationOnce(() => del)
      .mockImplementationOnce(() => ins)
      .mockImplementationOnce(() => relink)

    await replaceCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100 }])

    const insertedCells = (ins.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>[]
    expect(insertedCells[0].stage_id).toBe('s1')
    const relinked = (relink.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[]
    expect(relinked).toEqual([{ zone_id: 'z1', cell_id: 'new1' }])
  })

  it('gives a merged cell the union of its sources\' zones', async () => {
    // Spec 8.3: on merge, re-link the survivor into every zone the sources held.
    const existing = builder({ data: [] })
    const links = builder({
      data: [
        { zone_id: 'z1', cells: { code: 'R1C1', deck_id: 'd1' } },
        { zone_id: 'z2', cells: { code: 'R1C2', deck_id: 'd1' } },
      ],
    })
    const del = builder({})
    const ins = builder({ data: [{ id: 'merged', code: 'R1C1' }] })
    const relink = builder({})
    from
      .mockImplementationOnce(() => existing)
      .mockImplementationOnce(() => links)
      .mockImplementationOnce(() => del)
      .mockImplementationOnce(() => ins)
      .mockImplementationOnce(() => relink)

    await replaceCells(
      'd1',
      [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 200 }],
      { R1C1: ['R1C1', 'R1C2'] },
    )

    const relinked = (relink.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as { zone_id: string }[]
    expect(relinked.map((r) => r.zone_id).sort()).toEqual(['z1', 'z2'])
  })

  it('deletes the old cells before inserting the new ones', async () => {
    // replaceCells makes five sequential calls -- snapshot stage_id, snapshot
    // zone links, delete, insert, re-link -- so all five must be stubbed here.
    // Without the two snapshot stubs, the real delete() and insert() calls
    // land on exhausted mocks and the test fails for the wrong reason instead
    // of exercising the ordering it names.
    const order: string[] = []
    const existing = builder({ data: [] })
    const links = builder({ data: [] })
    const del = builder({})
    ;(del.delete as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('delete')
      return del
    })
    const ins = builder({ data: [{ id: 'new1', code: 'R1C1' }] })
    ;(ins.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('insert')
      return ins
    })
    from
      .mockImplementationOnce(() => existing)
      .mockImplementationOnce(() => links)
      .mockImplementationOnce(() => del)
      .mockImplementationOnce(() => ins)

    await replaceCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100 }])

    // Insert-then-delete would violate unique(deck_id, code) on any reused
    // code, which merging produces by design: a merged cell keeps the
    // top-left source's code.
    expect(order).toEqual(['delete', 'insert'])
  })

  it('throws when the delete fails and does not insert', async () => {
    // The failure must be injected on the delete call itself (the 3rd of the
    // five), not an earlier snapshot read -- otherwise this test would still
    // pass even if replaceCells stopped checking the delete error entirely.
    //
    // The cells array must be non-empty: with an empty array, the
    // `cells.length === 0` early return skips the insert regardless of
    // whether the delete error is checked at all, which would make "does not
    // insert" true for the wrong reason and not pinned on the delete guard.
    const existing = builder({ data: [] })
    const links = builder({ data: [] })
    const ins = builder({ data: [{ id: 'new1', code: 'R1C1' }] })
    from
      .mockImplementationOnce(() => existing)
      .mockImplementationOnce(() => links)
      .mockImplementationOnce(() => builder({ error: { message: 'delete blocked' } }))
      .mockImplementationOnce(() => ins)

    await expect(
      replaceCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 1 }]),
    ).rejects.toThrow('delete blocked')

    // Exactly 3 calls: snapshot, links, delete. A 4th would mean it inserted anyway.
    expect(from).toHaveBeenCalledTimes(3)
    expect(ins.insert).not.toHaveBeenCalled()
  })

  it('throws when the insert fails', async () => {
    // Same reasoning as above: the failure must land on the actual insert
    // call (the 4th), not an earlier snapshot read.
    const existing = builder({ data: [] })
    const links = builder({ data: [] })
    const del = builder({})
    from
      .mockImplementationOnce(() => existing)
      .mockImplementationOnce(() => links)
      .mockImplementationOnce(() => del)
      .mockImplementationOnce(() => builder({ error: { message: 'duplicate code' } }))
    await expect(
      replaceCells('d1', [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 1 }]),
    ).rejects.toThrow('duplicate code')
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
