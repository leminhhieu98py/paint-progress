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

describe('listStages', () => {
  it('parses a string-typed numeric weight into a number', async () => {
    from.mockImplementationOnce(() =>
      builder({
        data: [{ id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.25' }],
      }),
    )

    const stages = await listStages('d1')

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
    await expect(saveStages('d1', [stage(1, 0.5), stage(2, 0.4)])).rejects.toThrow(
      /must sum to 1/,
    )
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a sum within the floating-point epsilon', async () => {
    from.mockImplementation(() => builder({}))
    // 0.1 * 3 + 0.7 is 0.9999999999999999 in IEEE754, not 1.
    await expect(
      saveStages('d1', [stage(1, 0.1), stage(2, 0.1), stage(3, 0.1), stage(4, 0.7)]),
    ).resolves.toBeUndefined()
  })

  it('accepts a sum just inside the epsilon', async () => {
    from.mockImplementation(() => builder({}))
    // 1 - 9e-6 is inside 1e-5, so this must be accepted.
    await expect(saveStages('d1', [stage(1, 0.5), stage(2, 0.5 - 9e-6)])).resolves.toBeUndefined()
  })

  it('rejects a sum just outside the epsilon', async () => {
    // 1 - 1.1e-5 is outside, so this must be rejected. Pinned because an
    // off-by-one in the epsilon or a flipped operator would otherwise pass.
    await expect(saveStages('d1', [stage(1, 0.5), stage(2, 0.5 - 1.1e-5)])).rejects.toThrow(
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
      saveStages('d1', [stage(1, third), stage(2, third), stage(3, third)]),
    ).resolves.toBeUndefined()
  })

  it('exposes the epsilon it uses', () => {
    expect(STAGE_WEIGHT_EPSILON).toBe(1e-5)
  })

  it('rejects duplicate seq values', async () => {
    await expect(
      saveStages('d1', [stage(1, 0.5), { ...stage(1, 0.5), id: 's2' }]),
    ).rejects.toThrow(/seq/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects duplicate ids', async () => {
    // Two rows claiming one id would make the upsert's `do update` touch the
    // same row twice ("ON CONFLICT DO UPDATE command cannot affect row a second
    // time"), and would mean two stages sharing one set of recorded cells.
    // Rejected before any write, with a message about ids rather than seqs.
    await expect(
      saveStages('d1', [stage(1, 0.5), { ...stage(2, 0.5), id: 's1' }]),
    ).rejects.toThrow(/ids must be unique/)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects an empty stage list', async () => {
    await expect(saveStages('d1', [])).rejects.toThrow(/at least one stage/)
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

  /** The exact text Postgres raises for (deck_id, seq) -- see 0001 and 0012. */
  const DUPLICATE_SEQ =
    'duplicate key value violates unique constraint "deck_stages_deck_id_seq_key"'

  type StageRow = {
    id: string
    deck_id: string
    seq: number
    name: string
    color: string
    weight: number
  }

  /**
   * A stand-in for `deck_stages` that ENFORCES `unique (deck_id, seq)`.
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
   * command cannot affect row a second time"). saveStages rejects that before
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
        const key = `${r.deck_id}|${r.seq}`
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

  /** Five stages seq 1..5 under d1, the shape createProject seeds. */
  const fiveStages = (): StageRow[] => [
    { id: 'coat1', deck_id: 'd1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.2 },
    { id: 'coat2', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.2 },
    { id: 'coat3', deck_id: 'd1', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.2 },
    { id: 'coat4', deck_id: 'd1', seq: 4, name: 'Coat 4', color: '#1677ff', weight: 0.2 },
    { id: 'coat5', deck_id: 'd1', seq: 5, name: 'Coat 5', color: '#722ed1', weight: 0.2 },
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

    await saveStages('d1', [
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

    await saveStages('d1', [
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

    await saveStages('d1', [
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
      { id: 'coat1', deck_id: 'd1', seq: 1, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 'coat2', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
    ])
    from.mockImplementation(table.from)
    const cell = { code: 'R1C1', stage_id: 'coat1' }

    await saveStages('d1', [
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
    // saveStages, and it is not ceremony: the reason C1 shipped is that every
    // layer of evidence stood in for Postgres with something that accepts
    // anything. If the enforcement here is ever weakened, the four tests above
    // go on passing while meaning nothing -- so the enforcement itself is
    // pinned, in the two ways it has to behave.
    //
    // Driven directly for a second reason: once the delete goes first,
    // saveStages CANNOT construct a colliding write. Everything absent from the
    // draft is removed before the survivors are renumbered, and the draft's own
    // seqs are checked for uniqueness before any statement is issued. There is
    // deliberately no test claiming saveStages produces a duplicate key, because
    // it no longer can -- which is also why StageConfigPanel's translation of
    // that message is a last line of defence rather than a routine path.
    const table = stageTable([
      { id: 'coat1', deck_id: 'd1', seq: 1, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 'coat2', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
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
    // saveStages issued when it upserted before deleting.
    const collide = await upsert([
      { id: 'coat1', deck_id: 'd1', seq: 2, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
    ])
    expect(collide.error?.message).toBe(DUPLICATE_SEQ)
    // Rolled back whole, the way a rejected statement is.
    expect(table.rows().map((r) => [r.id, r.seq])).toEqual([['coat1', 1], ['coat2', 2]])

    // And the other half: the check is DEFERRED to the end of the statement, so
    // a swap that passes through a momentary tie is accepted. A row-by-row
    // check here would reject the reorder 0012 exists to allow.
    const swap = await upsert([
      { id: 'coat1', deck_id: 'd1', seq: 2, name: 'Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 'coat2', deck_id: 'd1', seq: 1, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
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

    await saveStages('d1', [
      { id: 's1', seq: 1, name: 'Renamed', color: '#111111', weight: 0.5 },
      { id: 's2', seq: 2, name: 'S2', color: '#000000', weight: 0.5 },
    ])

    expect(up.upsert).toHaveBeenCalledWith(
      [
        { id: 's1', deck_id: 'd1', seq: 1, name: 'Renamed', color: '#111111', weight: 0.5 },
        { id: 's2', deck_id: 'd1', seq: 2, name: 'S2', color: '#000000', weight: 0.5 },
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

    await saveStages('d1', [
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

    await saveStages('d1', [
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
    await saveStages('d1', [
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
    // Read, then DELETE, then upsert -- the order saveStages issues them in, and
    // the reason it does: see the write-order paragraph in projectsApi.ts.
    const del = builder({})
    const up = builder({})
    from
      .mockImplementationOnce(() => read)
      .mockImplementationOnce(() => del)
      .mockImplementationOnce(() => up)

    await saveStages('d1', [
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
      saveStages('d1', [{ id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 1 }]),
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
      saveStages('d1', [{ id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 1 }]),
    ).rejects.toThrow('upsert refused')

    expect(from).toHaveBeenCalledTimes(3)
    expect(del.in).toHaveBeenCalledWith('id', ['s2'])
  })

  it('throws when the snapshot read fails, before writing anything', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'network down' } }))

    await expect(
      saveStages('d1', [{ id: 's1', seq: 1, name: 'S1', color: '#000000', weight: 1 }]),
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
            decks: [
              {
                id: 'd1',
                code: 'CD',
                name: 'Cellar Deck',
                total_area_m2: '6139',
                deck_stages: [
                  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.25' },
                  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: '0.15' },
                  { id: 's3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: '0.35' },
                  { id: 's4', seq: 4, name: 'Coat 4', color: '#1677ff', weight: '0.15' },
                  { id: 's5', seq: 5, name: 'Tháo giáo', color: '#722ed1', weight: '0.1' },
                ],
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
