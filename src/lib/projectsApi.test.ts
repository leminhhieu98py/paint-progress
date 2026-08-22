import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Stage } from '../domain/types'
import {
  createProject,
  listProjects,
  listStages,
  myFirstProjectId,
  roundStageWeight,
  saveStages,
  STAGE_WEIGHT_EPSILON,
  stagesRemovedBy,
  updateProject,
} from './projectsApi'

const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from } }))

beforeEach(() => from.mockReset())

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
    id: `s${seq}`, seq, name: `S${seq}`, color: '#000000', weight,
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
    // 1 - 9e-6 is inside 1e-5, so this must be accepted.
    await expect(saveStages('p1', [stage(1, 0.5), stage(2, 0.5 - 9e-6)])).resolves.toBeUndefined()
  })

  it('rejects a sum just outside the epsilon', async () => {
    // 1 - 1.1e-5 is outside, so this must be rejected. Pinned because an
    // off-by-one in the epsilon or a flipped operator would otherwise pass.
    await expect(saveStages('p1', [stage(1, 0.5), stage(2, 0.5 - 1.1e-5)])).rejects.toThrow(
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
      saveStages('p1', [stage(1, third), stage(2, third), stage(3, third)]),
    ).resolves.toBeUndefined()
  })

  it('exposes the epsilon it uses', () => {
    expect(STAGE_WEIGHT_EPSILON).toBe(1e-5)
  })

  it('rejects duplicate seq values', async () => {
    await expect(
      saveStages('p1', [stage(1, 0.5), { ...stage(1, 0.5), id: 's2' }]),
    ).rejects.toThrow(/seq/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects duplicate ids', async () => {
    // Two rows claiming one id would make the upsert's `do update` touch the
    // same row twice ("ON CONFLICT DO UPDATE command cannot affect row a second
    // time"), and would mean two stages sharing one set of recorded cells.
    // Rejected before any write, with a message about ids rather than seqs.
    await expect(
      saveStages('p1', [stage(1, 0.5), { ...stage(2, 0.5), id: 's1' }]),
    ).rejects.toThrow(/ids must be unique/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects an empty stage list', async () => {
    await expect(saveStages('p1', [])).rejects.toThrow(/at least one stage/)
    expect(from).not.toHaveBeenCalled()
  })

  /** The persisted rows saveStages reads back before diffing, PostgREST-shaped. */
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

  it('upserts on the id, carrying every row\'s own id in the payload', async () => {
    // The whole point of the rewrite. Identity is the id, so a rename is an
    // UPDATE of the row the admin renamed -- not of whatever row happens to sit
    // at that seq. seq rides along as an ordinary column: display order.
    const read = persisted([{ id: 's1', seq: 1, weight: 0.5 }, { id: 's2', seq: 2, weight: 0.5 }])
    const up = builder({})
    from.mockImplementationOnce(() => read).mockImplementationOnce(() => up)

    await saveStages('p1', [
      { id: 's1', seq: 1, name: 'Renamed', color: '#111111', weight: 0.5 },
      { id: 's2', seq: 2, name: 'S2', color: '#000000', weight: 0.5 },
    ])

    expect(up.upsert).toHaveBeenCalledWith(
      [
        { id: 's1', project_id: 'p1', seq: 1, name: 'Renamed', color: '#111111', weight: 0.5 },
        { id: 's2', project_id: 'p1', seq: 2, name: 'S2', color: '#000000', weight: 0.5 },
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

    await saveStages('p1', [
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

    await saveStages('p1', [
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
    await saveStages('p1', [
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

  it('leaves a cell recorded at the stage it was recorded at when the list is reordered', async () => {
    // The one that matters. Every other assertion in this file is about the
    // payload; this one is about the consequence on the cell, which is where the
    // customer sees the damage.
    //
    // The stand-in below applies the upsert the way Postgres would: it matches
    // each payload row against the stored rows BY THE CONFLICT TARGET THE CODE
    // ITSELF NAMES, row by row. That is what makes this test able to fail --
    // keyed on (project_id, seq) it reproduces the real defect exactly, because
    // the first payload row lands on the row already sitting at the seq it is
    // moving into.
    const rows: Record<string, unknown>[] = [
      { id: 'coat1', project_id: 'p1', seq: 1, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 'coat2', project_id: 'p1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
    ]
    // A cell GS recorded at Coat 1. cells.stage_id points at the ROW and no part
    // of a stage save touches it, so it is a constant here -- which is the
    // point: whether it still means "Coat 1" afterwards depends entirely on what
    // the upsert did to the row it names.
    const cell = { code: 'R1C1', stage_id: 'coat1' }

    const read = persisted([
      { id: 'coat1', seq: 1, weight: 0.5, name: 'Coat 1' },
      { id: 'coat2', seq: 2, weight: 0.5, name: 'Coat 2' },
    ])
    const up = builder({})
    up.upsert = vi.fn((payload: Record<string, unknown>[], opts: { onConflict: string }) => {
      const key = opts.onConflict.split(',')
      const keyOf = (r: Record<string, unknown>) => key.map((k) => String(r[k])).join(' ')
      for (const incoming of payload) {
        const existing = rows.find((r) => keyOf(r) === keyOf(incoming))
        if (existing) Object.assign(existing, incoming)
        else rows.push({ ...incoming })
      }
      return up
    })
    from.mockImplementationOnce(() => read).mockImplementationOnce(() => up)

    // Coat 2 moves up: it takes seq 1 and Coat 1 takes seq 2. Nothing is removed.
    await saveStages('p1', [
      { id: 'coat2', seq: 1, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
      { id: 'coat1', seq: 2, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
    ])

    // The cell is still recorded at Coat 1 -- the stage it was recorded at --
    // and NOT at whatever stage now occupies the seq Coat 1 used to hold.
    const recordedAt = rows.find((r) => r.id === cell.stage_id)
    expect(recordedAt?.name).toBe('Coat 1')
    // The reorder did happen, so this is not passing because nothing moved: the
    // cell's own stage is now second in the paint sequence, and the row that
    // took its old seq is a different stage entirely.
    expect(recordedAt?.seq).toBe(2)
    expect(rows.find((r) => r.seq === 1)?.name).toBe('Coat 2')
    // Two rows in, two rows out: the reorder must not have inserted anything.
    expect(rows).toHaveLength(2)
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
    const up = builder({})
    const del = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => up)
      .mockImplementationOnce(() => del)

    await saveStages('p1', [
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
    // By id, never by project. A `.eq('project_id', 'p1')` delete is the defect
    // this rewrite exists to remove, and it would still satisfy the assertion
    // above if both were issued.
    expect(del.eq).not.toHaveBeenCalled()
  })

  it('throws when the upsert fails, and never reaches the delete', async () => {
    const read = persisted([{ id: 's1', seq: 1, weight: 0.5 }, { id: 's2', seq: 2, weight: 0.5 }])
    const del = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => builder({ error: { message: 'upsert refused' } }))
      .mockImplementationOnce(() => del)

    // The next list drops s2, so there IS a delete waiting: a third `from` call
    // would prove it ran anyway.
    await expect(
      saveStages('p1', [{ id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 1 }]),
    ).rejects.toThrow('upsert refused')

    expect(from).toHaveBeenCalledTimes(2)
    expect(del.delete).not.toHaveBeenCalled()
  })

  it('throws when the snapshot read fails, before writing anything', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'network down' } }))

    await expect(
      saveStages('p1', [{ id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 1 }]),
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
