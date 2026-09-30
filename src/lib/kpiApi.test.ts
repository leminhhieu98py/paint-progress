import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SPEC_ID } from '../test/copy'
import { PLAN_ROW_CAP, clearStagePlanArea, listStagePlans, saveStagePlan } from './kpiApi'

const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from } }))

/** The PostgREST builder shape: every method chains, awaiting resolves. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'upsert', 'update', 'eq', 'in', 'order', 'limit', 'range']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

/** PostgREST-shaped rows: `numeric` arrives as a string, `date` as 'YYYY-MM-DD'. */
const ROWS = [
  {
    stage_id: 's1', work_id: 'w1', deck_id: 'd1',
    start_date: '2026-09-01', end_date: '2026-09-12', planned_area_m2: '3300.00',
    works: { name: 'Sơn' },
    deck_stages: { name: 'Công đoạn 1' },
  },
  {
    stage_id: 's2', work_id: 'w1', deck_id: 'd1',
    start_date: '2026-09-09', end_date: '2026-09-16', planned_area_m2: null,
    works: { name: 'Sơn' },
    deck_stages: { name: 'Công đoạn 2' },
  },
]

const WRITE = {
  stageId: 's1', workId: 'w1', deckId: 'd1',
  startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: 3300,
}

beforeEach(() => {
  from.mockReset()
})

describe('listStagePlans', () => {
  it("reads the project's windows and maps the numerics off their strings", async () => {
    const b = builder({ data: ROWS })
    from.mockReturnValue(b)

    const rows = await listStagePlans('p1')

    expect(from).toHaveBeenCalledWith('stage_plans')
    // Filtered through the embedded work, because stage_plans carries no
    // project_id -- a coat's project is its work's.
    expect(b.eq).toHaveBeenCalledWith('works.project_id', 'p1')
    expect(rows).toEqual([
      {
        stageId: 's1', workId: 'w1', deckId: 'd1', workName: 'Sơn', stageName: 'Công đoạn 1',
        startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: 3300,
      },
      {
        stageId: 's2', workId: 'w1', deckId: 'd1', workName: 'Sơn', stageName: 'Công đoạn 2',
        startDate: '2026-09-09', endDate: '2026-09-16', plannedAreaM2: null,
      },
    ])
  })

  it('keeps a stored zero as zero rather than turning it into null', async () => {
    // 0 is a deliberate override meaning "this coat plans no area"; null means
    // "compute it". Number('0.00') is 0, and a truthiness check anywhere on
    // this path would collapse the two.
    const b = builder({ data: [{ ...ROWS[0], planned_area_m2: '0.00' }] })
    from.mockReturnValue(b)
    expect((await listStagePlans('p1'))[0].plannedAreaM2).toBe(0)
  })

  it('returns an empty list for a project with no windows yet', async () => {
    from.mockReturnValue(builder({ data: null }))
    expect(await listStagePlans('p1')).toEqual([])
  })

  it("surfaces a PostgREST error as a thrown Error carrying the server's message", async () => {
    from.mockReturnValue(builder({ error: { message: 'permission denied for table stage_plans' } }))
    await expect(listStagePlans('p1')).rejects.toThrow('permission denied for table stage_plans')
  })

  it('refuses a read that came back exactly at the row cap instead of reporting a short list', async () => {
    // RV5-03: a truncated read is never a silent zero. This read is NOT paged
    // -- see the comment on PLAN_ROW_CAP -- so it has to notice the one case
    // where that assumption has failed, rather than silently drawing a chart
    // that is missing coats.
    const full = Array.from({ length: PLAN_ROW_CAP }, (_, i) => ({ ...ROWS[0], stage_id: `s${i}` }))
    from.mockReturnValue(builder({ data: full }))
    await expect(listStagePlans('p1')).rejects.toThrow(/PLAN_ROW_CAP|1000/)
  })

  it('tells the reader what is missing in plain words and logs the developer detail (CPY-04)', async () => {
    // The message reaches the KPI screen's error alert: no spec id, no query
    // vocabulary. What the developer needs goes to the console instead.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const full = Array.from({ length: PLAN_ROW_CAP }, (_, i) => ({ ...ROWS[0], stage_id: `s${i}` }))
    from.mockReturnValue(builder({ data: full }))
    const error = await listStagePlans('p1').catch((e: unknown) => e as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(SPEC_ID)
    expect((error as Error).message).not.toMatch(/phân trang|truy vấn/)
    expect((error as Error).message).toMatch(/biểu đồ sẽ thiếu công đoạn/)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/PLAN_ROW_CAP/))
    // The log line carries no spec ids either (cleanup rule).
    expect(String(log.mock.calls[0][0])).not.toMatch(SPEC_ID)
    log.mockRestore()
  })

  it('accepts a read one row short of the cap', async () => {
    const nearly = Array.from({ length: PLAN_ROW_CAP - 1 }, (_, i) => ({ ...ROWS[0], stage_id: `s${i}` }))
    from.mockReturnValue(builder({ data: nearly }))
    expect(await listStagePlans('p1')).toHaveLength(PLAN_ROW_CAP - 1)
  })
})

describe('saveStagePlan', () => {
  it('upserts one window on the coat, in snake_case', async () => {
    const b = builder({ data: [{ stage_id: 's1' }] })
    from.mockReturnValue(b)

    await saveStagePlan(WRITE)

    expect(from).toHaveBeenCalledWith('stage_plans')
    expect(b.upsert).toHaveBeenCalledWith(
      {
        stage_id: 's1', work_id: 'w1', deck_id: 'd1',
        start_date: '2026-09-01', end_date: '2026-09-12', planned_area_m2: 3300,
      },
      { onConflict: 'stage_id' },
    )
  })

  it('writes a null area rather than omitting the column', async () => {
    // Omitting it would leave a previous override in place on an update, so
    // "clear this back to computed" has to be an explicit null on the payload.
    const b = builder({ data: [{ stage_id: 's1' }] })
    from.mockReturnValue(b)

    await saveStagePlan({ ...WRITE, plannedAreaM2: null })

    const payload = (b.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload).toHaveProperty('planned_area_m2', null)
  })

  it('writes a typed zero as zero, not as null', async () => {
    const b = builder({ data: [{ stage_id: 's1' }] })
    from.mockReturnValue(b)

    await saveStagePlan({ ...WRITE, plannedAreaM2: 0 })

    const payload = (b.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload).toHaveProperty('planned_area_m2', 0)
  })

  it('refuses a window whose end is before its start, without writing', async () => {
    const b = builder({ data: [] })
    from.mockReturnValue(b)

    await expect(saveStagePlan({ ...WRITE, startDate: '2026-09-12', endDate: '2026-09-01' }))
      .rejects.toThrow(/ngày kết thúc/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a same-day window', async () => {
    const b = builder({ data: [{ stage_id: 's1' }] })
    from.mockReturnValue(b)
    await expect(saveStagePlan({ ...WRITE, startDate: '2026-09-09', endDate: '2026-09-09' }))
      .resolves.toBeUndefined()
  })

  it('refuses a negative area, without writing', async () => {
    from.mockReturnValue(builder({ data: [] }))
    await expect(saveStagePlan({ ...WRITE, plannedAreaM2: -1 })).rejects.toThrow(/diện tích/i)
    expect(from).not.toHaveBeenCalled()
  })

  it("surfaces a PostgREST error as a thrown Error carrying the server's message", async () => {
    from.mockReturnValue(builder({ error: { message: 'new row violates row-level security policy' } }))
    await expect(saveStagePlan(WRITE)).rejects.toThrow('new row violates row-level security policy')
  })

  it('reports a write that RLS silently swallowed', async () => {
    // An UPDATE the policy hides returns zero rows and no error -- the shape
    // setWorkDeckDeadline already guards against. Reporting nothing here would
    // leave the admin looking at a saved-looking row that was never written.
    const b = builder({ data: [] })
    from.mockReturnValue(b)
    await expect(saveStagePlan(WRITE)).rejects.toThrow(/không lưu được/i)
    expect(b.select).toHaveBeenCalled()
  })
})

describe('clearStagePlanArea', () => {
  it('updates the area to null and nothing else', async () => {
    const b = builder({ data: [{ stage_id: 's1' }] })
    from.mockReturnValue(b)

    await clearStagePlanArea('s1')

    expect(from).toHaveBeenCalledWith('stage_plans')
    // The payload carries null, not 0: RV5-23's "a cleared override returns
    // the row to the computed figure", and 0 would be an override of zero.
    expect(b.update).toHaveBeenCalledWith({ planned_area_m2: null })
    expect(b.eq).toHaveBeenCalledWith('stage_id', 's1')
    // The dates are the admin's and are not touched by clearing the area.
    const payload = (b.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(Object.keys(payload)).toEqual(['planned_area_m2'])
  })

  it("surfaces a PostgREST error as a thrown Error carrying the server's message", async () => {
    from.mockReturnValue(builder({ error: { message: 'permission denied for table stage_plans' } }))
    await expect(clearStagePlanArea('s1')).rejects.toThrow('permission denied for table stage_plans')
  })

  it('reports a clear that matched no row', async () => {
    from.mockReturnValue(builder({ data: [] }))
    await expect(clearStagePlanArea('s1')).rejects.toThrow(/không lưu được/i)
  })
})
