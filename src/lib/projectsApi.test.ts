import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  deleteProject,
  listProjects,
  myFirstProjectId,
  updateProject,
} from './projectsApi'

const from = vi.hoisted(() => vi.fn())
const remove = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from, storage: { from: () => ({ remove }) } } }))

beforeEach(() => {
  from.mockReset()
  remove.mockReset()
})

/** Minimal PostgREST builder stub: every method chains, `then` resolves. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of [
    'select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'order', 'single', 'limit',
  ]) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

describe('listProjects', () => {
  /** Two decks under one bays work: one drawn with three bays (one at Coat 1),
   *  one with no drawing and no bays. Weights as the 0024 backfill writes them. */
  const twoDecks = [
    {
      id: 'p1',
      name: 'BB1 - CPPTS',
      code: 'BB1',
      works: [{
        id: 'w1', project_id: 'p1', seq: 1, name: 'Công việc chính', kind: 'bays', weight: '1', counts: true, manual_progress: '0',
        work_decks: [{ deck_id: 'd1', weight: '0.5' }, { deck_id: 'd2', weight: '0.5' }],
      }],
      decks: [
        {
          id: 'd1',
          seq: 1,
          code: 'MD',
          name: 'Main Deck',
          total_area_m2: 100,
          image_path: 'drawings/d1.png',
          deck_stages: [{ id: 's1', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'Coat 1', color: '#fadb14', weight: 1 }],
          cells: [
            { id: 'c1', code: 'R1C1', area_m2: 40 },
            { id: 'c2', code: 'R1C2', area_m2: 30 },
            { id: 'c3', code: 'R1C3', area_m2: 30 },
          ],
          cell_states: [{ cell_id: 'c1', work_id: 'w1', stage_id: 's1' }],
        },
        {
          id: 'd2',
          seq: 2,
          code: 'CD',
          name: 'Cellar Deck',
          total_area_m2: 100,
          image_path: null,
          deck_stages: [],
          cells: [],
          cell_states: [],
        },
      ],
    },
  ]

  it('counts every bay across the project', async () => {
    from.mockImplementationOnce(() => builder({ data: twoDecks }))
    const [row] = await listProjects()
    expect(row.cellCount).toBe(3)
  })

  it('counts only the decks that actually have a drawing attached', async () => {
    from.mockImplementationOnce(() => builder({ data: twoDecks }))
    const [row] = await listProjects()
    expect(row.decksWithDrawing).toBe(1)
    expect(row.deckCount).toBe(2)
  })

  it('rolls progress up by work: one work at weight 1, decks at 0.5 each, MD 40% done', async () => {
    from.mockImplementationOnce(() => builder({ data: twoDecks }))
    const [row] = await listProjects()
    // MD: 40 of 100 m² at the only coat -> 0.4; CD: nothing -> 0. Work: 0.5*0.4 + 0.5*0 = 0.2.
    expect(row.progress).toBeCloseTo(0.2, 12)
  })

  it('reports zeroes for a project with no decks and no works at all', async () => {
    from.mockImplementationOnce(() =>
      builder({ data: [{ id: 'p9', name: 'Trống', code: 'T', works: [], decks: [] }] }),
    )
    const [row] = await listProjects()
    expect(row).toMatchObject({ deckCount: 0, cellCount: 0, decksWithDrawing: 0, progress: 0 })
  })
})

describe('createProject', () => {
  it('inserts the project and returns its id', async () => {
    // It seeds nothing: stages belong to a deck, so the template is seeded by
    // createDeck. A project on its own has no stage list to be missing.
    const projectInsert = builder({ data: { id: 'p1' } })
    from.mockImplementationOnce(() => projectInsert)

    const id = await createProject({ name: 'BB1', code: 'BB1' })

    expect(id).toBe('p1')
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('projects')
    // Without .single(), insert().select() returns an array, so
    // (data as {id}).id would silently be undefined -- pin that it was called.
    expect(projectInsert.single).toHaveBeenCalled()
  })

  it('throws when the project insert fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'duplicate code' } }))
    await expect(createProject({ name: 'x', code: 'x' })).rejects.toThrow('duplicate code')
    expect(from).toHaveBeenCalledTimes(1)
  })
})

describe('myFirstProjectId', () => {
  it('returns the project_id of the first membership row', async () => {
    from.mockImplementationOnce(() => builder({ data: [{ project_id: 'p1' }] }))

    await expect(myFirstProjectId()).resolves.toBe('p1')
    expect(from).toHaveBeenCalledWith('project_members')
  })

  it('returns null rather than throwing when the GS has no membership', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))

    await expect(myFirstProjectId()).resolves.toBeNull()
  })

  it('throws when the read fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'network down' } }))

    await expect(myFirstProjectId()).rejects.toThrow('network down')
  })
})

describe('updateProject', () => {
  it('updates name and code by id', async () => {
    const b = builder({})
    from.mockImplementationOnce(() => b)

    await updateProject('p1', { name: 'New Name', code: 'NEW' })

    expect(from).toHaveBeenCalledWith('projects')
    expect(b.update).toHaveBeenCalledWith({ name: 'New Name', code: 'NEW' })
    expect(b.eq).toHaveBeenCalledWith('id', 'p1')
  })
})

describe('listProjects', () => {
  it('parses string-typed numerics and reproduces the Cellar Deck workbook progress', async () => {
    // Same shape PostgREST actually returns: numeric columns (weight,
    // total_area_m2, area_m2) serialise as strings; seq and other ints do not.
    // Cumulative-by-stage areas [5571, 5511, 2922.5, 2922.5, 0] and totalAreaM2
    // 6139 are the golden Cellar Deck fixture from domain/progress.test.ts,
    // where computeDeckProgress on this exact shape yields 0.599552044306890.
    // With one work at weight 1 holding the one deck at weight 1, the work
    // model collapses to that same per-deck value, so it is ground truth here
    // too, not invented.
    // Cell areas are the adjacent differences of the cumulative sequence: a
    // cell at stage 1 for 60 (5571-5511), one at stage 2 for 2588.5
    // (5511-2922.5), and one at stage 4 for 2922.5 (2922.5-0); no cell sits at
    // stage 3 or 5. Their sum, 5571, is deliberately less than
    // totalAreaM2 (6139) -- the leftover is deck area with no digitized cell --
    // so the test also pins that the denominator is total_area_m2, never a
    // sum of cell areas.
    from.mockImplementationOnce(() =>
      builder({
        data: [
          {
            id: 'proj1',
            name: 'BB1',
            code: 'BB1',
            works: [{
              id: 'w1', project_id: 'proj1', seq: 1, name: 'Công việc chính', kind: 'bays',
              weight: '1', counts: true, manual_progress: '0',
              work_decks: [{ deck_id: 'd1', weight: '1' }],
            }],
            decks: [
              {
                id: 'd1',
                seq: 1,
                code: 'CD',
                name: 'Cellar Deck',
                total_area_m2: '6139',
                deck_stages: [
                  { id: 's1', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.25' },
                  { id: 's2', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: '0.15' },
                  { id: 's3', work_id: 'w1', deck_id: 'd1', seq: 3, name: 'Coat 3', color: '#52c41a', weight: '0.35' },
                  { id: 's4', work_id: 'w1', deck_id: 'd1', seq: 4, name: 'Coat 4', color: '#1677ff', weight: '0.15' },
                  { id: 's5', work_id: 'w1', deck_id: 'd1', seq: 5, name: 'Tháo giáo', color: '#722ed1', weight: '0.1' },
                ],
                cells: [
                  { id: 'c1', code: 'C1', area_m2: '60' },
                  { id: 'c2', code: 'C2', area_m2: '2588.5' },
                  { id: 'c3', code: 'C3', area_m2: '2922.5' },
                ],
                cell_states: [
                  { cell_id: 'c1', work_id: 'w1', stage_id: 's1' },
                  { cell_id: 'c2', work_id: 'w1', stage_id: 's2' },
                  { cell_id: 'c3', work_id: 'w1', stage_id: 's4' },
                ],
              },
            ],
          },
        ],
      }),
    )

    const [row] = await listProjects()

    expect(row.deckCount).toBe(1)
    expect(row.totalAreaM2).toBe(6139)
    expect(row.progress).toBeCloseTo(0.599552044306890, 9)
  })
})

describe('deleteProject', () => {
  it('lists the drawings, deletes the project, then removes them in one call', async () => {
    // The paths have to be read BEFORE the row goes: the cascade takes the
    // decks with it, and with them the only record of which files are ours.
    const list = builder({ data: [{ image_path: 'p1/d1.png' }, { image_path: null }, { image_path: 'p1/d3.png' }] })
    const del = builder({ data: null })
    from.mockImplementationOnce(() => list)
    from.mockImplementationOnce(() => del)
    remove.mockResolvedValue({ data: [{ name: 'p1/d1.png' }, { name: 'p1/d3.png' }], error: null })

    const result = await deleteProject('p1')

    expect(from.mock.calls.map((c) => c[0])).toEqual(['decks', 'projects'])
    expect(list.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(del.delete).toHaveBeenCalled()
    expect(del.eq).toHaveBeenCalledWith('id', 'p1')
    expect(remove).toHaveBeenCalledWith(['p1/d1.png', 'p1/d3.png'])
    const deleteOrder = (del.delete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(remove.mock.invocationCallOrder[0]).toBeGreaterThan(deleteOrder)
    expect(result).toEqual({ drawingsRemoved: 2, drawingsTotal: 2 })
  })

  it('never touches storage when the project delete is refused', async () => {
    from.mockImplementationOnce(() => builder({ data: [{ image_path: 'p1/d1.png' }] }))
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(deleteProject('p1')).rejects.toThrow('permission denied')
    expect(remove).not.toHaveBeenCalled()
  })

  it('reports drawings it could not remove instead of failing a delete that has happened', async () => {
    from.mockImplementationOnce(() => builder({ data: [{ image_path: 'p1/d1.png' }, { image_path: 'p1/d2.png' }] }))
    from.mockImplementationOnce(() => builder({ data: null }))
    remove.mockResolvedValue({ data: null, error: { message: 'storage down' } })

    await expect(deleteProject('p1')).resolves.toEqual({ drawingsRemoved: 0, drawingsTotal: 2 })
  })

  it('removes nothing when no deck ever had a drawing', async () => {
    from.mockImplementationOnce(() => builder({ data: [{ image_path: null }] }))
    from.mockImplementationOnce(() => builder({ data: null }))

    await expect(deleteProject('p1')).resolves.toEqual({ drawingsRemoved: 0, drawingsTotal: 0 })
    expect(remove).not.toHaveBeenCalled()
  })
})
