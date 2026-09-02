import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  latestProgressEvent, listCellNotes, listDeckEvents, loadDeckProgress, loadProjectProgress,
  setReportNote,
} from './progressApi'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from, rpc } }))

/** The PostgREST builder shape: every method chains, and awaiting resolves to
 *  `{ data, error }` -- postgrest-js reports failure as a value, never a throw. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) b[m] = vi.fn(() => b)
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
  rpc.mockReset()
})

describe('loadProjectProgress', () => {
  it('returns each deck with its own stages, cells and drawing', async () => {
    from.mockImplementation(() => builder({ data: [ROW] }))

    const [entry] = await loadProjectProgress('p1')

    expect(entry.deck).toEqual({
      id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 6139,
      cells: [{
        id: 'c1', code: 'R1C1', x: 0.1, y: 0.2, w: 0.3, h: 0.4,
        areaM2: 60, stageId: 's1', note: '',
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
      id: 3, stageName: 'Coat 3', byName: 'Lê Trung Hiếu', byUsername: 'gs.hieu',
    })
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
    expect(b.eq).toHaveBeenCalledWith('cells.deck_id', 'd1')
    expect(b.order).toHaveBeenCalledWith('at', { ascending: true })
    expect(events).toEqual([{
      id: 5, cellCode: 'R1C1', cellAreaM2: 60, toStageName: 'Coat 2',
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
