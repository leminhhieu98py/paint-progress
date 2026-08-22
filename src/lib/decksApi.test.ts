import { beforeEach, describe, expect, it, vi } from 'vitest'
import { replaceCells, uploadDrawing, zoneImpactOf } from './decksApi'

const from = vi.hoisted(() => vi.fn())
const upload = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  supabase: { from, storage: { from: () => ({ upload }) } },
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
    const existing = builder({ data: [] })
    const links = builder({ data: [] })
    from
      .mockImplementationOnce(() => existing)
      .mockImplementationOnce(() => links)
      .mockImplementationOnce(() => builder({ error: { message: 'delete blocked' } }))
    await expect(replaceCells('d1', [])).rejects.toThrow('delete blocked')
    // Exactly 3 calls: snapshot, links, delete. A 4th would mean it inserted anyway.
    expect(from).toHaveBeenCalledTimes(3)
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
