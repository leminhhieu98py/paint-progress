import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Work } from '../domain/types'
import {
  deleteWork, listWorkDecks, listWorks, saveWorkDecks, saveWorks, setManualProgress,
} from './worksApi'

const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from } }))

function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'order', 'single']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

beforeEach(() => from.mockReset())

const work = (over: Partial<Work> = {}): Work => ({
  id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: 1, counts: true, manualProgress: 0, ...over,
})

describe('listWorks', () => {
  it('reads a project\'s works in seq order, coercing the numerics', async () => {
    const b = builder({
      data: [{ id: 'w1', project_id: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: '0.35', counts: true, manual_progress: '0' }],
    })
    from.mockImplementationOnce(() => b)

    const works = await listWorks('p1')

    expect(from).toHaveBeenCalledWith('works')
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.order).toHaveBeenCalledWith('seq')
    expect(works).toEqual([work({ weight: 0.35 })])
  })

  it('throws when the read fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(listWorks('p1')).rejects.toThrow('permission denied')
  })
})

describe('saveWorks', () => {
  it('rejects counted weights that do not sum to 1, before any write', async () => {
    await expect(saveWorks('p1', [work({ weight: 0.5 }), work({ id: 'w2', seq: 2, name: 'B', weight: 0.4 })]))
      .rejects.toThrow(/must sum to 1/)
    expect(from).not.toHaveBeenCalled()
  })

  it('ignores the weight of a work that does not count', async () => {
    // Linh's Marking row: weight 0, tracked, outside the total. Also a work
    // that does not count may carry any weight the admin left there.
    from.mockImplementation(() => builder({ data: [] }))
    await expect(saveWorks('p1', [
      work({ weight: 1 }),
      work({ id: 'w2', seq: 2, name: 'Marking', kind: 'manual', weight: 0.3, counts: false }),
    ])).resolves.toBeUndefined()
  })

  it('accepts a project with no counted work at all, and an empty list', async () => {
    from.mockImplementation(() => builder({ data: [] }))
    await expect(saveWorks('p1', [work({ counts: false, weight: 0 })])).resolves.toBeUndefined()
    await expect(saveWorks('p1', [])).resolves.toBeUndefined()
  })

  it('rejects duplicate names and duplicate seqs', async () => {
    await expect(saveWorks('p1', [work({ weight: 0.5 }), work({ id: 'w2', seq: 2, weight: 0.5 })]))
      .rejects.toThrow(/name/)
    await expect(saveWorks('p1', [work({ weight: 0.5 }), work({ id: 'w2', name: 'B', weight: 0.5 })]))
      .rejects.toThrow(/seq/)
    expect(from).not.toHaveBeenCalled()
  })

  it('deletes the works the admin removed, then upserts the rest, keyed by id', async () => {
    const existing = builder({ data: [
      { id: 'w1', project_id: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: '1', counts: true, manual_progress: '0' },
      { id: 'w9', project_id: 'p1', seq: 2, name: 'Cũ', kind: 'manual', weight: '0', counts: false, manual_progress: '0' },
    ] })
    const del = builder({ data: null })
    const up = builder({ data: null })
    from.mockImplementationOnce(() => existing).mockImplementationOnce(() => del).mockImplementationOnce(() => up)

    await saveWorks('p1', [work()])

    expect(del.delete).toHaveBeenCalled()
    expect(del.in).toHaveBeenCalledWith('id', ['w9'])
    expect(up.upsert).toHaveBeenCalledWith(
      [{ id: 'w1', project_id: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: 1, counts: true, manual_progress: 0 }],
      { onConflict: 'id' },
    )
  })

  it('issues no delete when nothing was removed', async () => {
    from.mockImplementationOnce(() => builder({ data: [] })).mockImplementationOnce(() => builder({ data: null }))
    await saveWorks('p1', [work()])
    expect(from).toHaveBeenCalledTimes(2)
  })
})

describe('deleteWork', () => {
  it('deletes by id and reports success', async () => {
    const b = builder({ data: [{ id: 'w1' }] })
    from.mockImplementationOnce(() => b)
    await deleteWork('w1')
    expect(from).toHaveBeenCalledWith('works')
    expect(b.delete).toHaveBeenCalled()
    expect(b.eq).toHaveBeenCalledWith('id', 'w1')
  })

  it('throws when the row was not deleted', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
    await expect(deleteWork('w1')).rejects.toThrow(/not deleted/)
  })
})

describe('listWorkDecks / saveWorkDecks', () => {
  it('reads the decks in a work with their weights', async () => {
    const b = builder({ data: [{ deck_id: 'd1', weight: '0.6' }, { deck_id: 'd2', weight: '0.4' }] })
    from.mockImplementationOnce(() => b)
    expect(await listWorkDecks('w1')).toEqual([{ deckId: 'd1', weight: 0.6 }, { deckId: 'd2', weight: 0.4 }])
    expect(b.eq).toHaveBeenCalledWith('work_id', 'w1')
  })

  it('rejects deck weights that do not sum to 1, before any write', async () => {
    await expect(saveWorkDecks('w1', [{ deckId: 'd1', weight: 0.5 }, { deckId: 'd2', weight: 0.4 }]))
      .rejects.toThrow(/must sum to 1/)
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts an empty deck list: a work nobody has assigned yet', async () => {
    from.mockImplementationOnce(() => builder({ data: [{ deck_id: 'd1', weight: '1' }] }))
    const del = builder({ data: null })
    from.mockImplementationOnce(() => del)
    await saveWorkDecks('w1', [])
    expect(del.delete).toHaveBeenCalled()
    expect(del.in).toHaveBeenCalledWith('deck_id', ['d1'])
  })

  it('removes the decks no longer in the work, then upserts the rest', async () => {
    from.mockImplementationOnce(() => builder({ data: [{ deck_id: 'd1', weight: '0.5' }, { deck_id: 'd3', weight: '0.5' }] }))
    const del = builder({ data: null })
    const up = builder({ data: null })
    from.mockImplementationOnce(() => del).mockImplementationOnce(() => up)

    await saveWorkDecks('w1', [{ deckId: 'd1', weight: 0.7 }, { deckId: 'd2', weight: 0.3 }])

    expect(del.in).toHaveBeenCalledWith('deck_id', ['d3'])
    expect(up.upsert).toHaveBeenCalledWith(
      [{ work_id: 'w1', deck_id: 'd1', weight: 0.7 }, { work_id: 'w1', deck_id: 'd2', weight: 0.3 }],
      { onConflict: 'work_id,deck_id' },
    )
  })
})

describe('setManualProgress', () => {
  it('writes the typed percentage as a 0..1 fraction', async () => {
    const b = builder({ data: [{ id: 'w1' }] })
    from.mockImplementationOnce(() => b)
    await setManualProgress('w1', 0.19)
    expect(b.update).toHaveBeenCalledWith({ manual_progress: 0.19 })
    expect(b.eq).toHaveBeenCalledWith('id', 'w1')
  })

  it('rejects a value outside 0..1 before writing', async () => {
    await expect(setManualProgress('w1', 1.2)).rejects.toThrow(/0 and 1/)
    await expect(setManualProgress('w1', -0.1)).rejects.toThrow(/0 and 1/)
    expect(from).not.toHaveBeenCalled()
  })
})
