import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDeckProgress, loadProjectProgress } from './progressApi'

const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from } }))

/** The PostgREST builder shape: every method chains, and awaiting resolves to
 *  `{ data, error }` -- postgrest-js reports failure as a value, never a throw. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) b[m] = vi.fn(() => b)
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

/** One deck, PostgREST-shaped: numeric columns come back as strings. */
const ROW = {
  id: 'd1',
  seq: 1,
  code: 'CD',
  name: 'Cellar Deck',
  total_area_m2: '6139.00',
  area_source: 'prorated',
  image_path: 'p1/d1.png',
  image_w: 2000,
  image_h: 1600,
  deck_stages: [
    { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: '0.15' },
    { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.85' },
  ],
  cells: [
    {
      id: 'c1', code: 'R1C1', x: '0.1', y: '0.2', w: '0.3', h: '0.4',
      area_m2: '60.00', stage_id: 's1',
      updated_at: '2026-08-20T10:00:00+00:00', updated_by: 'u1',
    },
  ],
}

beforeEach(() => {
  from.mockReset()
})

describe('loadProjectProgress', () => {
  it('returns each deck with its own stages, cells and drawing', async () => {
    from.mockImplementation(() => builder({ data: [ROW] }))

    const [entry] = await loadProjectProgress('p1')

    expect(entry.deck).toEqual({
      id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 6139,
      cells: [{
        id: 'c1', code: 'R1C1', x: 0.1, y: 0.2, w: 0.3, h: 0.4,
        areaM2: 60, stageId: 's1',
      }],
    })
    expect(entry.imagePath).toBe('p1/d1.png')
    expect(entry.imageW).toBe(2000)
    expect(entry.imageH).toBe(1600)
    expect(entry.seq).toBe(1)
  })

  it('sorts each deck\'s stages by seq', async () => {
    // The embed returns them in whatever order the planner picked. Every
    // consumer -- nextStage, the spec table, scaffoldLensColors -- reads the
    // sequence, and an unsorted list silently reorders the paint system.
    from.mockImplementation(() => builder({ data: [ROW] }))

    const [entry] = await loadProjectProgress('p1')

    expect(entry.stages.map((s) => s.seq)).toEqual([1, 2])
    expect(entry.stages.map((s) => s.name)).toEqual(['Blast + Coat 1', 'Coat 2'])
  })

  it('coerces every numeric column, so a weight is a number and not a string', async () => {
    // PostgREST serialises `numeric` as a string. An uncoerced weight makes
    // `Σ wᵢ·pᵢ` concatenate, which renders as a plausible-looking percentage
    // rather than throwing.
    from.mockImplementation(() => builder({ data: [ROW] }))

    const [entry] = await loadProjectProgress('p1')

    expect(entry.stages.map((s) => s.weight)).toEqual([0.85, 0.15])
    expect(entry.deck.totalAreaM2).toBe(6139)
    expect(entry.deck.cells[0].areaM2).toBe(60)
  })

  it('scopes the query to the project and orders the decks by seq', async () => {
    const b = builder({ data: [] })
    from.mockImplementation(() => b)

    await loadProjectProgress('p1')

    expect(from).toHaveBeenCalledWith('decks')
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.order).toHaveBeenCalledWith('seq')
  })

  it('carries the audit columns and the area provenance for the report', async () => {
    // Spec §9's per-deck sheet lists who last moved each bay and when, and has
    // to disclose when the areas were prorated rather than measured.
    from.mockImplementation(() => builder({ data: [ROW] }))

    const [entry] = await loadProjectProgress('p1')

    expect(entry.areaSource).toBe('prorated')
    expect(entry.audit.c1).toEqual({
      updatedAt: '2026-08-20T10:00:00+00:00',
      updatedBy: 'u1',
    })
  })

  it('defaults a deck with no drawing, no stages and no cells rather than throwing', async () => {
    // Every one of these is reachable: a deck created a minute ago has no
    // drawing, and PostgREST omits an embed that matched nothing.
    from.mockImplementation(() => builder({
      data: [{ id: 'd9', seq: 3, code: 'RF', name: 'Roof', total_area_m2: '0' }],
    }))

    const [entry] = await loadProjectProgress('p1')

    expect(entry.imagePath).toBeNull()
    expect(entry.imageW).toBeNull()
    expect(entry.imageH).toBeNull()
    expect(entry.stages).toEqual([])
    expect(entry.deck.cells).toEqual([])
    // A deck created a minute ago has never had its areas measured, and
    // 'guides' is the column's own default.
    expect(entry.areaSource).toBe('guides')
    expect(entry.audit).toEqual({})
  })

  it('throws when the query fails', async () => {
    from.mockImplementation(() => builder({ error: { message: 'permission denied' } }))
    await expect(loadProjectProgress('p1')).rejects.toThrow('permission denied')
  })
})

describe('loadDeckProgress', () => {
  it('returns one deck through the same mapper the project read uses', async () => {
    const b = builder({ data: [ROW] })
    from.mockImplementation(() => b)

    const entry = (await loadDeckProgress('d1'))!

    expect(b.eq).toHaveBeenCalledWith('id', 'd1')
    expect(entry.deck.code).toBe('CD')
    expect(entry.stages.map((s) => s.seq)).toEqual([1, 2])
    expect(entry.areaSource).toBe('prorated')
    expect(entry.audit.c1?.updatedBy).toBe('u1')
  })

  it('returns null for a deck that is not there, rather than throwing', async () => {
    // Reachable from a stale URL, and from a deck another admin has deleted.
    from.mockImplementation(() => builder({ data: [] }))
    expect(await loadDeckProgress('gone')).toBeNull()
  })

  it('throws when the query fails', async () => {
    from.mockImplementation(() => builder({ error: { message: 'permission denied' } }))
    await expect(loadDeckProgress('d1')).rejects.toThrow('permission denied')
  })
})
