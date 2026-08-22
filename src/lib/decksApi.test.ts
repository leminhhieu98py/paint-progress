import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDeck, getDrawingUrl, listCells, listDecks, listGuides, saveGuides,
  syncCells, updateDeckArea, uploadDrawing, zoneImpactOf,
} from './decksApi'

const from = vi.hoisted(() => vi.fn())
const upload = vi.hoisted(() => vi.fn())
const createSignedUrl = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  supabase: { from, storage: { from: () => ({ upload, createSignedUrl }) } },
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
  upload.mockReset()
  createSignedUrl.mockReset()
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
      imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
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

    const id = await createDeck({ projectId: 'p1', seq: 3, name: 'Roof', code: 'RF' })

    expect(id).toBe('d9')
    expect(stub.insert).toHaveBeenCalledWith({
      project_id: 'p1', seq: 3, name: 'Roof', code: 'RF',
    })
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

describe('listGuides', () => {
  it('maps a guide\'s numeric fields, including the axis and its id', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{ id: 'g1', axis: 'x', pos: '0.500000', offset_mm: '12000.00' }],
    }))

    const guides = await listGuides('d1')

    expect(guides).toEqual([{ id: 'g1', axis: 'x', pos: 0.5, offsetMm: 12000 }])
  })

  it('scopes to the deck and orders by offset_mm', async () => {
    const stub = builder({ data: [] })
    from.mockImplementationOnce(() => stub)

    await listGuides('d1')

    expect(stub.eq).toHaveBeenCalledWith('deck_id', 'd1')
    // B12: without this, both current consumers happen to re-sort themselves
    // so it is benign today, but it is an unstated non-guarantee this endpoint
    // should not leave to its callers.
    expect(stub.order).toHaveBeenCalledWith('offset_mm')
  })

  it('throws when the query fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(listGuides('d1')).rejects.toThrow('permission denied')
  })
})

describe('saveGuides', () => {
  type GuideRow = { id: string; deck_id: string; axis: 'x' | 'y'; pos: number; offset_mm: number }

  /**
   * A stand-in for `deck_guides` that holds ROWS, so what a test asserts is what
   * the deck would still contain -- not which builder answered which call.
   *
   * The call-counting version of these tests could not fail. "A failed upsert
   * cannot lose an existing guide" was expressed as "the second `from` call
   * errored and the third builder was untouched", which stays true when the
   * delete and the upsert swap places: the delete simply becomes the statement
   * that errors, having already removed the guide the test claims survived. That
   * is the same shape of hole that let the stage-removal regression through three
   * layers of evidence, one table over.
   *
   * `failOn` fails one statement without applying it, the way a rejected
   * statement leaves the table alone.
   */
  function guideTable(initial: GuideRow[], failOn?: 'upsert' | 'delete') {
    let rows = initial.map((r) => ({ ...r }))
    const statements: string[] = []

    const from = () => {
      let op: 'select' | 'upsert' | 'delete' | null = null
      let payload: GuideRow[] = []
      let conflictTarget: string[] = []
      let ids: string[] | null = null
      const filters: [string, unknown][] = []

      const run = (): { data: unknown; error: unknown } => {
        statements.push(op ?? 'none')
        if (op === failOn) return { data: null, error: { message: `${op} refused` } }
        const matches = (r: GuideRow) =>
          filters.every(([col, v]) => (r as unknown as Record<string, unknown>)[col] === v)

        if (op === 'delete') {
          // No id list means a filter-only delete -- the deck-wide wipe this
          // rewrite exists to remove. Modelled faithfully so it shows up as
          // missing rows rather than as a passing assertion.
          rows = rows.filter((r) => !(matches(r) && (ids === null || ids.includes(r.id))))
          return { data: null, error: null }
        }
        if (op === 'upsert') {
          const keyOf = (r: Record<string, unknown>) =>
            conflictTarget.map((k) => String(r[k])).join('|')
          for (const incoming of payload) {
            const existing = rows.find((r) => keyOf(r) === keyOf(incoming))
            if (existing) Object.assign(existing, incoming)
            else rows.push({ ...incoming })
          }
          return { data: null, error: null }
        }
        return {
          data: rows
            .filter(matches)
            .slice()
            .sort((a, b) => a.offset_mm - b.offset_mm)
            .map((r) => ({
              id: r.id, axis: r.axis, pos: String(r.pos), offset_mm: String(r.offset_mm),
            })),
          error: null,
        }
      }

      const b: Record<string, unknown> = {}
      b.select = vi.fn(() => { op = 'select'; return b })
      b.delete = vi.fn(() => { op = 'delete'; return b })
      b.insert = vi.fn((p: GuideRow[]) => {
        // The pre-rewrite write shape. Kept so a reverted saveGuides is answered
        // rather than crashing on an undefined method: an insert appends rows
        // with no identity, which is exactly what it used to do.
        op = 'upsert'
        payload = p
        conflictTarget = ['id']
        return b
      })
      b.upsert = vi.fn((p: GuideRow[], opts: { onConflict: string }) => {
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

  /** Two x-guides 14500 mm apart on deck d1 -- the shape every fixture here uses. */
  const twoGuides = (): GuideRow[] => [
    { id: 'g1', deck_id: 'd1', axis: 'x', pos: 0, offset_mm: 0 },
    { id: 'g2', deck_id: 'd1', axis: 'x', pos: 1, offset_mm: 14500 },
  ]

  it('keeps an untouched guide on its own row across a save', async () => {
    // The whole point of the rewrite. A guide the admin did not touch is an
    // UPDATE of its own row, so its id survives and there is nothing for a later
    // failure to lose. Under the delete-then-insert version both ids changed on
    // every save, which is why identity was not available to diff on at all.
    const table = guideTable(twoGuides())
    from.mockImplementation(table.from)

    await saveGuides('d1', [
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 14500.5 },
    ])

    expect(table.rows()).toEqual([
      { id: 'g1', deck_id: 'd1', axis: 'x', pos: 0, offset_mm: 0 },
      { id: 'g2', deck_id: 'd1', axis: 'x', pos: 1, offset_mm: 14500.5 },
    ])
    // Nothing removed, so no delete round trip at all.
    expect(table.statements).toEqual(['select', 'upsert'])
  })

  it('cannot lose an existing guide when the upsert fails', async () => {
    // The failure the rewrite exists for, asserted on the rows that survive.
    //
    // A save now fires on every cell delete and every merge, so this runs on a
    // site tether constantly. When it fails, the deck must still hold its mm
    // chain -- local state is the only other copy, and closing the editor would
    // have lost it for good. The upsert is issued BEFORE the delete precisely so
    // a failure here has deleted nothing.
    const table = guideTable(twoGuides(), 'upsert')
    from.mockImplementation(table.from)

    // g2 dropped, so there is a delete queued behind the upsert that just failed.
    await expect(
      saveGuides('d1', [{ id: 'g1', axis: 'x', pos: 0, offsetMm: 0 }]),
    ).rejects.toThrow('upsert refused')

    expect(table.rows()).toEqual(twoGuides())
    expect(table.statements).toEqual(['select', 'upsert'])
  })

  it('loses nothing the admin typed when the delete fails after the upsert', async () => {
    // The half-failure this order deliberately chooses. The typed offsets are
    // committed and the deck keeps one stale guide, which shows up on the next
    // generated mesh as a spurious column and is fixable from the screen.
    const table = guideTable(twoGuides(), 'delete')
    from.mockImplementation(table.from)

    await expect(
      saveGuides('d1', [{ id: 'g1', axis: 'x', pos: 0, offsetMm: 250 }]),
    ).rejects.toThrow('delete refused')

    expect(table.rows()).toEqual([
      { id: 'g1', deck_id: 'd1', axis: 'x', pos: 0, offset_mm: 250 },
      { id: 'g2', deck_id: 'd1', axis: 'x', pos: 1, offset_mm: 14500 },
    ])
  })

  it('removes only the guide the admin deleted', async () => {
    const table = guideTable([
      ...twoGuides(),
      { id: 'g3', deck_id: 'd1', axis: 'x', pos: 0.5, offset_mm: 7000 },
    ])
    from.mockImplementation(table.from)

    await saveGuides('d1', [
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 14500 },
    ])

    expect(table.rows().map((r) => r.id)).toEqual(['g1', 'g2'])
  })

  it('leaves another deck\'s guides alone', async () => {
    // The delete is by id, but a deck-wide `.eq('deck_id', ...)` delete would
    // still pass every assertion above -- this is the one that separates them,
    // and it is why the stand-in honours filters instead of ignoring them.
    const table = guideTable([
      ...twoGuides(),
      { id: 'other', deck_id: 'd2', axis: 'x', pos: 0, offset_mm: 0 },
    ])
    from.mockImplementation(table.from)

    await saveGuides('d1', [{ id: 'g1', axis: 'x', pos: 0, offsetMm: 0 }])

    expect(table.rows().map((r) => r.id)).toEqual(['g1', 'other'])
  })

  it('carries a newly minted id into the upsert, so a new guide is an insert of a known row', async () => {
    // DeckEditor mints the id when the admin adds the guide, so the row arrives
    // already identified rather than needing to be matched up afterwards.
    const table = guideTable(twoGuides())
    from.mockImplementation(table.from)

    await saveGuides('d1', [
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 14500 },
      { id: 'fresh-uuid', axis: 'x', pos: 0.5, offsetMm: 7000 },
    ])

    expect(table.rows().map((r) => r.id)).toEqual(['g1', 'g2', 'fresh-uuid'])
  })

  it('upserts on the id, with the payload PostgREST expects', async () => {
    const read = builder({ data: [] })
    const up = builder({})
    from.mockImplementationOnce(() => read).mockImplementationOnce(() => up)

    await saveGuides('d1', [{ id: 'g1', axis: 'y', pos: 0.25, offsetMm: 4000 }])

    expect(up.upsert).toHaveBeenCalledWith(
      [{ id: 'g1', deck_id: 'd1', axis: 'y', pos: 0.25, offset_mm: 4000 }],
      { onConflict: 'id' },
    )
  })

  it('clears every guide without an upsert when the new set is empty', async () => {
    // Deleting the last guide is a legitimate edit, so an empty set still has to
    // remove the persisted rows -- by their ids, not by the deck.
    const table = guideTable(twoGuides())
    from.mockImplementation(table.from)

    await saveGuides('d1', [])

    expect(table.rows()).toEqual([])
    // An upsert([]) round trip could only ever write nothing.
    expect(table.statements).toEqual(['select', 'delete'])
  })

  it('issues no write at all for a deck that has no guides and is given none', async () => {
    const table = guideTable([])
    from.mockImplementation(table.from)

    await saveGuides('d1', [])

    expect(table.statements).toEqual(['select'])
  })

  it('throws when the snapshot read fails, before writing anything', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'network down' } }))

    await expect(
      saveGuides('d1', [{ id: 'g1', axis: 'x', pos: 0, offsetMm: 0 }]),
    ).rejects.toThrow('network down')

    expect(from).toHaveBeenCalledTimes(1)
  })
})

describe('listCells', () => {
  it('maps a cell\'s numeric fields and its recorded stage', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{
        id: 'c1', code: 'R1C1', x: '0.000000', y: '0.000000',
        w: '0.500000', h: '1.000000', area_m2: '100.00', stage_id: 's1',
      }],
    }))

    const cells = await listCells('d1')

    expect(cells).toEqual([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: 's1' },
    ])
  })

  it('reports null, not undefined, for a cell with no recorded stage', async () => {
    from.mockImplementationOnce(() => builder({
      data: [{ id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, area_m2: 10, stage_id: null }],
    }))

    const [cell] = await listCells('d1')

    expect(cell.stageId).toBeNull()
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
