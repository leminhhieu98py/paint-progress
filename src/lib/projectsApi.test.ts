import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, saveStages, STAGE_WEIGHT_EPSILON } from './projectsApi'

const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from } }))

beforeEach(() => from.mockReset())

/** Minimal PostgREST builder stub: every method chains, `then` resolves. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single']) {
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
    const seeded = (stageInsert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[]
    expect(seeded).toHaveLength(5)
    expect(seeded.every((s) => (s as { project_id: string }).project_id === 'p1')).toBe(true)
  })

  it('throws when the project insert fails, and does not seed stages', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'duplicate code' } }))
    await expect(createProject({ name: 'x', code: 'x' })).rejects.toThrow('duplicate code')
    expect(from).toHaveBeenCalledTimes(1)
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

  it('exposes the epsilon it uses', () => {
    expect(STAGE_WEIGHT_EPSILON).toBe(1e-6)
  })

  it('rejects duplicate seq values', async () => {
    await expect(saveStages('p1', [stage(1, 0.5), stage(1, 0.5)])).rejects.toThrow(/seq/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects an empty stage list', async () => {
    await expect(saveStages('p1', [])).rejects.toThrow(/at least one stage/)
  })
})
