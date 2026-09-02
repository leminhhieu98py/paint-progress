import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  latestProgressEvent, listCellNotes, listDeckEvents, loadDeckProgress, loadDeckWorks,
  loadProjectModel, loadProjectProgress, setReportNote,
} from './progressApi'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from, rpc } }))

/** The PostgREST builder shape: every method chains, and awaiting resolves to
 *  `{ data, error }` -- postgrest-js reports failure as a value, never a throw. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = vi.fn(() => b)
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

/**
 * PostgREST-shaped rows, numeric columns as strings. One project, one bays
 * work at weight 1 holding one deck at weight 1 -- the shape 0024's backfill
 * creates -- plus a manual work outside the total.
 */
const WORK_ROWS = [
  { id: 'w1', project_id: 'p1', seq: 1, name: 'Công việc chính', kind: 'bays', weight: '1', counts: true, manual_progress: '0',
    work_decks: [{ deck_id: 'd1', weight: '1' }] },
  { id: 'wm', project_id: 'p1', seq: 2, name: 'Marking', kind: 'manual', weight: '0', counts: false, manual_progress: '0.12',
    work_decks: [] },
]
const DECK_ROW = {
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
    { id: 's2', work_id: 'w1', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: '0.15' },
    { id: 's1', work_id: 'w1', deck_id: 'd1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: '0.85' },
  ],
  cells: [
    { id: 'c1', code: 'R1C1', x: '0.1', y: '0.2', w: '0.3', h: '0.4', area_m2: '60.00' },
  ],
}
const STATE_ROWS = [
  { cell_id: 'c1', work_id: 'w1', deck_id: 'd1', stage_id: 's1', note: 'ẩm',
    updated_at: '2026-08-20T10:00:00+00:00', updated_by: 'u1' },
]
const WORK_DECK_ROWS = [
  { work_id: 'w1', deck_id: 'd1', weight: '1',
    works: { id: 'w1', project_id: 'p1', seq: 1, name: 'Công việc chính', kind: 'bays', weight: '1', counts: true, manual_progress: '0' } },
]

/** The three reads loadProjectModel makes, in order: works, decks, cell_states. */
function mockProject(works = WORK_ROWS, decks: unknown[] = [DECK_ROW], states: unknown[] = STATE_ROWS) {
  const b = { works: builder({ data: works }), decks: builder({ data: decks }), states: builder({ data: states }) }
  from.mockImplementation((table: string) => {
    if (table === 'works') return b.works
    if (table === 'decks') return b.decks
    if (table === 'cell_states') return b.states
    throw new Error(`unexpected table ${table}`)
  })
  return b
}

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
})

describe('loadProjectModel', () => {
  it('reads works, decks and states, and assembles the model', async () => {
    const b = mockProject()

    const model = await loadProjectModel('p1')

    expect(b.works.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.decks.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.states.in).toHaveBeenCalledWith('deck_id', ['d1'])
    expect(model.models.map((m) => m.work.id)).toEqual(['w1', 'wm'])
    const cd = model.models[0].decks[0]
    expect(cd.weight).toBe(1)
    expect(cd.stages.map((s) => s.seq)).toEqual([1, 2])
    expect(cd.deck.cells).toEqual([{
      id: 'c1', code: 'R1C1', x: 0.1, y: 0.2, w: 0.3, h: 0.4, areaM2: 60, stageId: 's1', note: 'ẩm',
    }])
    expect(model.decks[0]).toMatchObject({ code: 'CD', imagePath: 'p1/d1.png', imageW: 2000, areaSource: 'prorated', cellCount: 1 })
    expect(model.audit.w1.c1).toEqual({ updatedAt: '2026-08-20T10:00:00+00:00', updatedBy: 'u1' })
  })

  it('skips the state read for a project with no decks', async () => {
    const b = mockProject(WORK_ROWS, [], [])
    const model = await loadProjectModel('p1')
    expect(b.states.in).not.toHaveBeenCalled()
    expect(model.models[0].decks).toEqual([])
  })

  it('throws when any read fails', async () => {
    from.mockImplementation(() => builder({ error: { message: 'permission denied' } }))
    await expect(loadProjectModel('p1')).rejects.toThrow('permission denied')
  })
})

describe('loadDeckWorks', () => {
  function mockDeck(decks: unknown[] = [DECK_ROW], workDecks: unknown[] = WORK_DECK_ROWS, states: unknown[] = STATE_ROWS) {
    const b = { decks: builder({ data: decks }), wd: builder({ data: workDecks }), states: builder({ data: states }) }
    from.mockImplementation((table: string) => {
      if (table === 'decks') return b.decks
      if (table === 'work_decks') return b.wd
      if (table === 'cell_states') return b.states
      throw new Error(`unexpected table ${table}`)
    })
    return b
  }

  it('returns the deck with one view per bays work it is part of', async () => {
    const b = mockDeck()

    const dw = (await loadDeckWorks('d1'))!

    expect(b.decks.eq).toHaveBeenCalledWith('id', 'd1')
    expect(b.wd.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(b.states.eq).toHaveBeenCalledWith('deck_id', 'd1')
    expect(dw.deck).toMatchObject({ id: 'd1', code: 'CD', totalAreaM2: 6139 })
    expect(dw.imagePath).toBe('p1/d1.png')
    expect(dw.areaSource).toBe('prorated')
    expect(dw.works).toHaveLength(1)
    expect(dw.works[0].work.name).toBe('Công việc chính')
    expect(dw.works[0].weight).toBe(1)
    expect(dw.works[0].stages.map((s) => s.name)).toEqual(['Blast + Coat 1', 'Coat 2'])
    expect(dw.works[0].cells[0]).toMatchObject({ id: 'c1', stageId: 's1', note: 'ẩm' })
    expect(dw.works[0].audit.c1?.updatedBy).toBe('u1')
  })

  it('returns null for a deck that is not there, rather than throwing', async () => {
    mockDeck([], [], [])
    expect(await loadDeckWorks('gone')).toBeNull()
  })

  it('gives a deck in no work an empty list of views, with its geometry intact', async () => {
    mockDeck([DECK_ROW], [], [])
    const dw = (await loadDeckWorks('d1'))!
    expect(dw.works).toEqual([])
    expect(dw.deck.cells).toHaveLength(1)
  })

  it('throws when the deck read fails', async () => {
    from.mockImplementation(() => builder({ error: { message: 'permission denied' } }))
    await expect(loadDeckWorks('d1')).rejects.toThrow('permission denied')
  })
})

describe('loadProjectProgress (transitional, first bays work)', () => {
  it('projects every deck for the first bays work, the shape the old screens still read', async () => {
    mockProject()
    const [entry] = await loadProjectProgress('p1')
    expect(entry.deck.cells[0]).toMatchObject({ stageId: 's1', note: 'ẩm' })
    expect(entry.stages.map((s) => s.seq)).toEqual([1, 2])
    expect(entry.imagePath).toBe('p1/d1.png')
    expect(entry.areaSource).toBe('prorated')
    expect(entry.audit.c1?.updatedBy).toBe('u1')
  })

  it('returns no entries for a project with no bays work', async () => {
    mockProject([WORK_ROWS[1]], [DECK_ROW], [])
    expect(await loadProjectProgress('p1')).toEqual([])
  })
})

describe('loadDeckProgress (transitional, first bays work)', () => {
  it('returns one deck through the first work it is part of', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'decks') return builder({ data: [DECK_ROW] })
      if (table === 'work_decks') return builder({ data: WORK_DECK_ROWS })
      if (table === 'cell_states') return builder({ data: STATE_ROWS })
      throw new Error(`unexpected table ${table}`)
    })
    const entry = (await loadDeckProgress('d1'))!
    expect(entry.deck.code).toBe('CD')
    expect(entry.stages.map((s) => s.seq)).toEqual([1, 2])
    expect(entry.deck.cells[0].stageId).toBe('s1')
  })

  it('returns null for a deck that is not there', async () => {
    from.mockImplementation(() => builder({ data: [] }))
    expect(await loadDeckProgress('gone')).toBeNull()
  })
})

describe('latestProgressEvent', () => {
  const EVENT = {
    at: '2026-08-28T09:42:11.000Z',
    to_stage_name: 'Coat 3',
    cells: { code: 'R7C11' },
    by: { username: 'gs.hieu', full_name: 'Lê Trung Hiếu' },
  }

  it('reads the newest row, not an arbitrary one', async () => {
    const b = builder({ data: [EVENT] })
    from.mockImplementationOnce(() => b)

    await latestProgressEvent()

    expect(from).toHaveBeenCalledWith('cell_events')
    // Without both of these the header would show whichever row Postgres
    // happened to return first -- a plausible-looking timestamp from months
    // ago, presented as "just now".
    expect(b.order).toHaveBeenCalledWith('at', { ascending: false })
    expect(b.limit).toHaveBeenCalledWith(1)
  })

  it('flattens the embedded cell and author', async () => {
    from.mockImplementationOnce(() => builder({ data: [EVENT] }))
    await expect(latestProgressEvent()).resolves.toEqual({
      at: '2026-08-28T09:42:11.000Z',
      cellCode: 'R7C11',
      toStageName: 'Coat 3',
      byName: 'Lê Trung Hiếu',
      byUsername: 'gs.hieu',
    })
  })

  it('keeps a null stage name, which is a bay sent back to not-started', async () => {
    from.mockImplementationOnce(() =>
      builder({ data: [{ ...EVENT, to_stage_name: null }] }),
    )
    const e = await latestProgressEvent()
    expect(e?.toStageName).toBeNull()
  })

  it('survives an author whose profile row is gone', async () => {
    // cell_events.by is a nullable FK and the trigger writes auth.uid(); a
    // deleted profile leaves the embed null. The event still happened and its
    // timestamp is still the answer to "when was the last record".
    from.mockImplementationOnce(() => builder({ data: [{ ...EVENT, by: null }] }))
    const e = await latestProgressEvent()
    expect(e).toMatchObject({ cellCode: 'R7C11', byName: null, byUsername: null })
  })

  it('returns null on an empty table rather than throwing', async () => {
    from.mockImplementationOnce(() => builder({ data: [] }))
    await expect(latestProgressEvent()).resolves.toBeNull()
  })

  it('throws when the read fails', async () => {
    from.mockImplementationOnce(() => builder({ error: { message: 'permission denied' } }))
    await expect(latestProgressEvent()).rejects.toThrow('permission denied')
  })
})

describe('listCellNotes', () => {
  const event = (over: Record<string, unknown>) => ({
    id: 1,
    at: '2026-08-29T11:47:00Z',
    to_stage_name: 'Coat 2',
    work_name: 'Sơn',
    note: 'Bề mặt còn ẩm',
    by: 'u1',
    author: { username: 'gs.hieu', full_name: 'Lê Trung Hiếu' },
    report_note: null,
    report_hidden: false,
    report_edited_at: null,
    report_editor: null,
    ...over,
  })

  it('names the author and the report editor by their own foreign keys, and keeps the raw author id', async () => {
    // Two embeds on one table: without the constraint hint PostgREST cannot
    // tell which profiles join is which. The raw `by` id travels too, so a
    // tablet -- which cannot read profiles -- can still resolve a name.
    const b = builder({ data: [event({})] })
    from.mockImplementation(() => b)

    const [note] = await listCellNotes('c1')

    expect(b.select).toHaveBeenCalledWith(expect.stringContaining(' by, '))
    expect(b.select).toHaveBeenCalledWith(
      expect.stringContaining('author:profiles!cell_events_by_fkey(username, full_name)'),
    )
    expect(b.select).toHaveBeenCalledWith(
      expect.stringContaining('report_editor:profiles!cell_events_report_edited_by_fkey(full_name)'),
    )
    expect(note.byId).toBe('u1')
  })

  it('carries the report-facing version, its hidden flag and who set them', async () => {
    from.mockImplementation(() => builder({
      data: [event({
        report_note: 'Bề mặt ẩm, đã sơn lại ngày sau',
        report_hidden: true,
        report_edited_at: '2026-09-02T03:00:00Z',
        report_editor: { full_name: 'Đoàn Công Linh' },
      })],
    }))

    const [note] = await listCellNotes('c1')

    expect(note).toMatchObject({
      note: 'Bề mặt còn ẩm',
      reportNote: 'Bề mặt ẩm, đã sơn lại ngày sau',
      reportHidden: true,
      reportEditedAt: '2026-09-02T03:00:00Z',
      reportEditedByName: 'Đoàn Công Linh',
    })
  })

  it('reads a note nobody has touched for the report as plain', async () => {
    from.mockImplementation(() => builder({ data: [event({})] }))

    const [note] = await listCellNotes('c1')

    expect(note).toMatchObject({
      reportNote: null, reportHidden: false, reportEditedAt: null, reportEditedByName: null,
    })
  })

  it('reads one bay\'s whole history, newest first', async () => {
    // cells.note holds only the latest -- each stage change overwrites it,
    // because the drawing needs one flag per bay. A bay that went Blast →
    // Coat 2 → Coat 3 with a remark at each step has all three only here.
    const b = builder({
      data: [
        event({ id: 3, at: '2026-08-29T11:47:00Z', to_stage_name: 'Coat 3', note: 'Xong' }),
        event({ id: 1, at: '2026-08-27T08:00:00Z', to_stage_name: 'Blast + Coat 1', note: 'Bắt đầu' }),
      ],
    })
    from.mockImplementation(() => b)

    const notes = await listCellNotes('c1')

    expect(from).toHaveBeenCalledWith('cell_events')
    expect(b.eq).toHaveBeenCalledWith('cell_id', 'c1')
    expect(b.order).toHaveBeenCalledWith('at', { ascending: false })
    expect(notes.map((n) => n.note)).toEqual(['Xong', 'Bắt đầu'])
    expect(notes[0]).toMatchObject({
      id: 3, stageName: 'Coat 3', byName: 'Lê Trung Hiếu', byUsername: 'gs.hieu', workName: 'Sơn',
    })
    expect(b.select).toHaveBeenCalledWith(expect.stringContaining('work_name'))
  })

  it('drops the stage changes nobody wrote anything on', async () => {
    // A coat recorded without a remark is not a message. On a bay ticked five
    // times, four blank rows would bury the one that says something.
    from.mockImplementation(() => builder({
      data: [event({ id: 2, note: '   ' }), event({ id: 1, note: null }), event({ id: 3 })],
    }))

    const notes = await listCellNotes('c1')

    expect(notes.map((n) => n.id)).toEqual([3])
  })

  it('keeps a note whose author is no longer readable', async () => {
    // profiles is behind RLS and an account can be switched off. The note is
    // the point; the name is attribution, and losing it must not lose the note.
    from.mockImplementation(() => builder({ data: [event({ author: null })] }))

    const notes = await listCellNotes('c1')

    expect(notes[0].note).toBe('Bề mặt còn ẩm')
    expect(notes[0].byName).toBeNull()
    // The id is on the event itself, not behind profiles' RLS.
    expect(notes[0].byId).toBe('u1')
  })

  it('reports a failed read rather than showing an empty history', async () => {
    // An empty list and a failed read look identical on screen, and one of them
    // means "this bay has no notes" -- which is a thing the admin acts on.
    from.mockImplementation(() => builder({ error: { message: 'mất kết nối' } }))
    await expect(listCellNotes('c1')).rejects.toThrow('mất kết nối')
  })
})

describe('setReportNote', () => {
  it('writes through the admin-only rpc, never the table', async () => {
    // 0008 revoked every client write on cell_events and 0023 adds no UPDATE
    // policy: the audit table is reachable only through its trigger and this
    // function, which checks is_admin() itself.
    rpc.mockResolvedValue({ data: null, error: null })

    await setReportNote(7, 'Bề mặt ẩm, đã sơn lại ngày sau', false)

    expect(rpc).toHaveBeenCalledWith('set_report_note', {
      p_event_id: 7, p_report_note: 'Bề mặt ẩm, đã sơn lại ngày sau', p_hidden: false,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('stores whitespace as no override, so clearing the box restores the original', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await setReportNote(7, '   ', true)

    expect(rpc).toHaveBeenCalledWith('set_report_note', {
      p_event_id: 7, p_report_note: null, p_hidden: true,
    })
  })

  it('reports a refused write', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'set_report_note: admin only' } })
    await expect(setReportNote(7, 'x', false)).rejects.toThrow('admin only')
  })
})

describe('listDeckEvents', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 5,
    at: '2026-08-29T11:47:00Z',
    to_stage_name: 'Coat 2',
    work_name: 'Sơn',
    by: 'u1',
    note: 'Bề mặt còn ẩm',
    report_note: null,
    report_hidden: false,
    cells: { deck_id: 'd1', code: 'R1C1', area_m2: '60.00' },
    ...over,
  })

  it('reads every stage change on one deck, oldest first, through the cell it belongs to', async () => {
    // cell_events has no deck_id; the deck is reached through cells. `!inner`
    // so the filter on the embedded column actually filters rows rather than
    // nulling the embed.
    const b = builder({ data: [row({})] })
    from.mockImplementation(() => b)

    const events = await listDeckEvents('d1')

    expect(from).toHaveBeenCalledWith('cell_events')
    expect(b.select).toHaveBeenCalledWith(expect.stringContaining('cells!inner(deck_id, code, area_m2)'))
    expect(b.select).toHaveBeenCalledWith(expect.stringContaining('work_name'))
    expect(b.eq).toHaveBeenCalledWith('cells.deck_id', 'd1')
    expect(b.order).toHaveBeenCalledWith('at', { ascending: true })
    expect(events).toEqual([{
      id: 5, cellCode: 'R1C1', cellAreaM2: 60, workName: 'Sơn', toStageName: 'Coat 2',
      at: '2026-08-29T11:47:00Z', byId: 'u1', note: 'Bề mặt còn ẩm',
      reportNote: null, reportHidden: false,
    }])
  })

  it('keeps a stage change that carried no note, as an empty note', async () => {
    // Unlike the note thread, this list IS the history: a coat recorded
    // without a remark is still a row on the report.
    from.mockImplementation(() => builder({
      data: [row({ note: null, to_stage_name: null })],
    }))

    const [event] = await listDeckEvents('d1')

    expect(event.note).toBe('')
    expect(event.toStageName).toBeNull()
  })

  it('reports a failed read rather than an empty history', async () => {
    from.mockImplementation(() => builder({ error: { message: 'mất kết nối' } }))
    await expect(listDeckEvents('d1')).rejects.toThrow('mất kết nối')
  })
})
