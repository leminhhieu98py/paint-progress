import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  listProjects,
  listStages,
  myFirstProjectId,
  saveStages,
  STAGE_WEIGHT_EPSILON,
  updateProject,
} from './projectsApi'

const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from } }))

beforeEach(() => from.mockReset())

/** Minimal PostgREST builder stub: every method chains, `then` resolves. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single', 'limit']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

describe('createProject', () => {
  it('inserts the project then seeds the five default stages', async () => {
    const projectInsert = builder({ data: { id: 'p1' } })
    const stageInsert = builder({})
    from.mockImplementationOnce(() => projectInsert).mockImplementationOnce(() => stageInsert)

    const id = await createProject({ name: 'BB1', code: 'BB1' })

    expect(id).toBe('p1')
    expect(from).toHaveBeenNthCalledWith(1, 'projects')
    expect(from).toHaveBeenNthCalledWith(2, 'project_stages')
    // Without .single(), insert().select() returns an array, so
    // (data as {id}).id would silently be undefined -- pin that it was called.
    expect(projectInsert.single).toHaveBeenCalled()
    const seeded = (stageInsert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[]
    expect(seeded).toHaveLength(5)
    expect(seeded.every((s) => (s as { project_id: string }).project_id === 'p1')).toBe(true)
  })

  it('throws when the project insert fails, and does not seed stages', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'duplicate code' } }))
    await expect(createProject({ name: 'x', code: 'x' })).rejects.toThrow('duplicate code')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('rolls back the project when the stage seed fails', async () => {
    const projectInsert = builder({ data: { id: 'p1' } })
    const stageInsert = builder({ error: { message: 'seed failed' } })
    const projectDelete = builder({})
    from
      .mockImplementationOnce(() => projectInsert)
      .mockImplementationOnce(() => stageInsert)
      .mockImplementationOnce(() => projectDelete)

    await expect(createProject({ name: 'x', code: 'x' })).rejects.toThrow('seed failed')

    expect(projectInsert.single).toHaveBeenCalled()
    expect(from).toHaveBeenNthCalledWith(3, 'projects')
    expect(projectDelete.delete).toHaveBeenCalled()
    expect(projectDelete.eq).toHaveBeenCalledWith('id', 'p1')
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

describe('listStages', () => {
  it('parses a string-typed numeric weight into a number', async () => {
    from.mockImplementationOnce(() =>
      builder({
        data: [{ id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.25' }],
      }),
    )

    const stages = await listStages('p1')

    expect(stages).toEqual([
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
    ])
  })
})

describe('saveStages', () => {
  const stage = (seq: number, weight: number) => ({
    seq, name: `S${seq}`, color: '#000000', weight,
  })

  it('rejects a weight set that does not sum to 1', async () => {
    await expect(saveStages('p1', [stage(1, 0.5), stage(2, 0.4)])).rejects.toThrow(
      /must sum to 1/,
    )
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a sum within the floating-point epsilon', async () => {
    from.mockImplementation(() => builder({}))
    // 0.1 * 3 + 0.7 is 0.9999999999999999 in IEEE754, not 1.
    await expect(
      saveStages('p1', [stage(1, 0.1), stage(2, 0.1), stage(3, 0.1), stage(4, 0.7)]),
    ).resolves.toBeUndefined()
  })

  it('accepts a sum just inside the epsilon', async () => {
    from.mockImplementation(() => builder({}))
    // 1 - 9e-7 is inside 1e-6, so this must be accepted.
    await expect(saveStages('p1', [stage(1, 0.5), stage(2, 0.5 - 9e-7)])).resolves.toBeUndefined()
  })

  it('rejects a sum just outside the epsilon', async () => {
    // 1 - 1.1e-6 is outside, so this must be rejected. Pinned because an
    // off-by-one in the epsilon or a flipped operator would otherwise pass.
    await expect(saveStages('p1', [stage(1, 0.5), stage(2, 0.5 - 1.1e-6)])).rejects.toThrow(
      /must sum to 1/,
    )
    expect(from).not.toHaveBeenCalled()
  })

  it('exposes the epsilon it uses', () => {
    expect(STAGE_WEIGHT_EPSILON).toBe(1e-6)
  })

  it('rejects duplicate seq values', async () => {
    await expect(saveStages('p1', [stage(1, 0.5), stage(1, 0.5)])).rejects.toThrow(/seq/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects an empty stage list', async () => {
    await expect(saveStages('p1', [])).rejects.toThrow(/at least one stage/)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('listProjects', () => {
  it('parses string-typed numerics and reproduces the Cellar Deck workbook progress', async () => {
    // Same shape PostgREST actually returns: numeric columns (weight,
    // total_area_m2, area_m2) serialise as strings; seq and other ints do not.
    // Cumulative-by-stage areas [5571, 5511, 2922.5, 2922.5, 0] and totalAreaM2
    // 6139 are the golden Cellar Deck fixture from domain/progress.test.ts,
    // where computeDeckProgress on this exact shape yields 0.599552044306890.
    // With a single deck in the project, computeProjectProgress collapses to
    // that same per-deck value, so it is ground truth here too, not invented.
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
            project_stages: [
              { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.25' },
              { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: '0.15' },
              { id: 's3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: '0.35' },
              { id: 's4', seq: 4, name: 'Coat 4', color: '#1677ff', weight: '0.15' },
              { id: 's5', seq: 5, name: 'Tháo giáo', color: '#722ed1', weight: '0.1' },
            ],
            decks: [
              {
                id: 'd1',
                code: 'CD',
                name: 'Cellar Deck',
                total_area_m2: '6139',
                cells: [
                  { id: 'c1', code: 'C1', area_m2: '60', stage_id: 's1' },
                  { id: 'c2', code: 'C2', area_m2: '2588.5', stage_id: 's2' },
                  { id: 'c3', code: 'C3', area_m2: '2922.5', stage_id: 's4' },
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
