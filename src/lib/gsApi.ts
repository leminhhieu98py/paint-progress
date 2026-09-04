import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { EMPTY_EFFORT, type Cell, type Effort, type Stage, type Work, type WorkModel } from '../domain/types'
import {
  assembleProjectModel, mapStage, mapWork, type DeckRowIn, type StageRowIn, type StateRowIn,
  type WorkDeckRow, type WorkRow,
} from './workModel'
import { supabase } from './supabase'

/**
 * A deck as the GS screen needs it: the drawing, its pixel dimensions, and the
 * authoritative area every percentage divides by.
 *
 * Deliberately not decksApi's `DeckRow`, which also carries `projectId` and
 * `cellCount` -- the GS screen has the project id from the route and counts
 * nothing, and inventing two fields to satisfy a shared type would make the
 * payload lie about what was fetched.
 */
export interface GsDeck {
  id: string
  seq: number
  name: string
  code: string
  imagePath: string | null
  imageW: number | null
  imageH: number | null
  /** Authoritative deck area. The denominator for every percentage (spec §3.2). */
  totalAreaM2: number
  areaSource: 'guides' | 'prorated'
}

export interface GsProject {
  decks: GsDeck[]
  /**
   * Whether the signed-in user actually holds a `project_members` row for this
   * project.
   *
   * Fetched because RLS makes a refusal and an empty project indistinguishable
   * from the outside: `/gs/:projectId` gates on role alone, so a GS deep-linking
   * to a project they are not in gets zero stages and zero decks -- no error, no
   * empty payload to catch -- and the screen renders "Sàn này chưa có bản vẽ"
   * over "Tổng diện tích sàn: 0,00 m²". That is the exact shape of a project
   * whose drawings the admin has not uploaded yet. This project's rule, adopted
   * after a Phase 1 defect of the same class, is that a refusal must never
   * render as missing data.
   *
   * `project_members_self_read` (0006) is `user_id = auth.uid()`, so this reads
   * the caller's own row and nothing else -- the same policy myFirstProjectId
   * relies on from the index route. It cannot tell "not a member of this
   * project" from "this project does not exist", and deliberately does not try:
   * both get the same message, so nothing leaks about which ids exist.
   */
  isMember: boolean
}

export type GsRealtimeStatus = 'subscribed' | 'disconnected'

/**
 * One mapper for both read paths.
 *
 * decksApi.listCells produces the same shape from the same table, and this is a
 * deliberate near-duplicate rather than a call into it: the realtime payload is
 * not a PostgREST select result, and having the socket and the query disagree
 * about how a row becomes a Cell is exactly the divergence that would put two
 * different area values on one screen.
 *
 * Every numeric column is coerced. PostgREST returns `numeric` as a string, and
 * Realtime's own conversion has changed across versions; an uncoerced area_m2
 * makes `sum + cell.areaM2` concatenate, which renders as a plausible-looking
 * number rather than throwing.
 */
function mapCellRow(row: Record<string, unknown>): Cell {
  return {
    id: row.id as string,
    code: row.code as string,
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    areaM2: Number(row.area_m2),
    stageId: (row.stage_id as string | null) ?? null,
    note: (row.note as string | null) ?? '',
  }
}

/**
 * The project's decks and whether the caller is a member of it at all -- in one
 * parallel batch.
 *
 * Stages are not here: they belong to a deck, so the screen fetches the active
 * deck's own set once the foreman has picked one.
 *
 * The membership read rides along here rather than being a second call from the
 * screen so that the two cannot land in different render passes: a screen that
 * learned "no decks" before "not a member" would flash the empty-project state
 * at somebody it is about to refuse.
 */
export async function loadGsProject(projectId: string): Promise<GsProject> {
  const [decksResult, membershipResult] = await Promise.all([
    supabase
      .from('decks')
      .select('id, seq, name, code, image_path, image_w, image_h, total_area_m2, area_source')
      .eq('project_id', projectId)
      .order('seq'),
    supabase
      .from('project_members')
      .select('project_id')
      .eq('project_id', projectId)
      .limit(1),
  ])
  if (decksResult.error) throw new Error(decksResult.error.message)
  // Thrown, not treated as "not a member": a failed membership read is a network
  // or policy fault, and reporting it as a refusal would tell a foreman with a
  // dropped tether to go and find the administrator.
  if (membershipResult.error) throw new Error(membershipResult.error.message)

  return {
    isMember: (membershipResult.data ?? []).length > 0,
    decks: (decksResult.data ?? []).map((d) => ({
      id: d.id as string,
      seq: d.seq as number,
      name: d.name as string,
      code: d.code as string,
      imagePath: (d.image_path as string | null) ?? null,
      imageW: (d.image_w as number | null) ?? null,
      imageH: (d.image_h as number | null) ?? null,
      totalAreaM2: Number(d.total_area_m2),
      areaSource: d.area_source as 'guides' | 'prorated',
    })),
  }
}

/** One deck's cells. Ordered by code so the cell list is stable across reloads. */
/**
 * A deck's bays, geometry only. Since 0024 a bay's position lives in
 * cell_states, one row per work; the screen lays the selected work's states
 * (listDeckStates) over these, so every bay comes back not started here.
 */
export async function listDeckCells(deckId: string): Promise<Cell[]> {
  const { data, error } = await supabase
    .from('cells')
    .select('id, code, x, y, w, h, area_m2')
    .eq('deck_id', deckId)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? []).map((c) => mapCellRow(c as Record<string, unknown>))
}

/**
 * Who a tablet may name: every admin, and everyone sharing a project with the
 * signed-in GS. Keyed by user id.
 *
 * `profiles` is admin-plus-self behind RLS, so a GS asking it directly learns
 * nobody's name but their own -- and the note thread would print "Không rõ
 * người ghi" on every remark. `coworker_names()` (0022) is a definer function
 * that decides the audience itself and returns two columns, which is the
 * narrowest window that answers the question.
 *
 * Throws on failure rather than returning `{}`: an empty map and a failed
 * read render identically, and it is the screen's decision to carry on with
 * anonymous notes, not this function's.
 */
export async function listCoworkerNames(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('coworker_names')
  if (error) throw new Error(error.message)
  const names: Record<string, string> = {}
  for (const r of (data ?? []) as { id: string; full_name: string }[]) names[r.id] = r.full_name
  return names
}

/**
 * The project's code and name, for the export a tablet makes of the deck tab
 * it has open (Feedback Rv1, item 6): the file is named `tien-do-<code>-<deck>`
 * and the workbook is headed with both.
 *
 * Its own read, made at export time, rather than a third query inside
 * loadGsProject: the screen never shows either field, and an export is a rare
 * action. RLS (`projects_member_read`) answers a non-member with zero rows,
 * which is refused here rather than turned into a file called
 * `tien-do--CD-...`: a nameless report is not a report.
 */
export async function loadGsProjectIdentity(
  projectId: string,
): Promise<{ code: string; name: string }> {
  const { data, error } = await supabase
    .from('projects')
    .select('code, name')
    .eq('id', projectId)
  if (error) throw new Error(error.message)
  const row = (data ?? [])[0] as { code: string; name: string } | undefined
  if (!row) throw new Error('Không đọc được dự án để đặt tên báo cáo.')
  return { code: row.code, name: row.name }
}

/** One bay's position in one work, as the tablet keeps it in memory. */
export interface CellStateView {
  stageId: string | null
  note: string
}

/**
 * A deck's bay states, indexed by work then by bay: states[workId][cellId].
 * A bay with no row for a work is simply absent, and reads as not started.
 */
export async function listDeckStates(
  deckId: string,
): Promise<Record<string, Record<string, CellStateView>>> {
  const { data, error } = await supabase
    .from('cell_states')
    .select('cell_id, work_id, stage_id, note')
    .eq('deck_id', deckId)
  if (error) throw new Error(error.message)
  const index: Record<string, Record<string, CellStateView>> = {}
  for (const r of (data ?? []) as { cell_id: string; work_id: string; stage_id: string | null; note: string | null }[]) {
    ;(index[r.work_id] ??= {})[r.cell_id] = { stageId: r.stage_id ?? null, note: r.note ?? '' }
  }
  return index
}

/** One bays work as the deck screen sees it: the work, its weight for this deck, its coats here. */
export interface DeckWork {
  work: Work
  /** D_wd. */
  weight: number
  stages: Stage[]
}

/**
 * The bays works a deck is part of, in seq order, each with its coats for
 * this deck. What the work selector above the drawing lists.
 */
export async function listDeckWorks(deckId: string): Promise<DeckWork[]> {
  const membershipQuery = await supabase
    .from('work_decks')
    .select('work_id, weight, works!inner(id, project_id, seq, name, kind, weight, counts, manual_progress)')
    .eq('deck_id', deckId)
  if (membershipQuery.error) throw new Error(membershipQuery.error.message)
  const stagesQuery = await supabase
    .from('deck_stages')
    .select('id, work_id, seq, name, color, weight')
    .eq('deck_id', deckId)
    .order('seq')
  if (stagesQuery.error) throw new Error(stagesQuery.error.message)

  const stagesByWork = new Map<string, Stage[]>()
  for (const row of (stagesQuery.data ?? []) as unknown as StageRowIn[]) {
    const list = stagesByWork.get(row.work_id) ?? []
    list.push(mapStage(row))
    stagesByWork.set(row.work_id, list)
  }
  return ((membershipQuery.data ?? []) as unknown as { work_id: string; weight: string | number; works: WorkRow }[])
    .map((m) => ({
      work: mapWork(m.works),
      weight: Number(m.weight),
      stages: (stagesByWork.get(m.work_id) ?? []).sort((a, b) => a.seq - b.seq),
    }))
    .filter((m) => m.work.kind === 'bays')
    .sort((a, b) => a.work.seq - b.work.seq)
}

/**
 * The work models the deck tabs need: for each requested deck, every work of
 * the project with that deck alone inside it, so `summariseDeck` reads the
 * right weight and the right bays. Three reads for any number of decks --
 * works (with weights), decks (with bays and coats), states.
 *
 * Every requested deck gets an entry, including one in no work at all; the
 * caller divides by these, and a missing key would throw on the tab rather
 * than read 0%.
 */
export async function listProjectIndex(
  projectId: string,
  deckIds: string[],
): Promise<Record<string, WorkModel[]>> {
  if (deckIds.length === 0) return {}
  const worksQuery = await supabase
    .from('works')
    .select('id, project_id, seq, name, kind, weight, counts, manual_progress, work_decks(deck_id, weight)')
    .eq('project_id', projectId)
    .order('seq')
  if (worksQuery.error) throw new Error(worksQuery.error.message)
  const decksQuery = await supabase
    .from('decks')
    .select('id, seq, code, name, total_area_m2, cells(id, code, area_m2), deck_stages(id, work_id, deck_id, seq, name, color, weight)')
    .in('id', deckIds)
  if (decksQuery.error) throw new Error(decksQuery.error.message)
  const statesQuery = await supabase
    .from('cell_states')
    .select('cell_id, work_id, deck_id, stage_id, note')
    .in('deck_id', deckIds)
  if (statesQuery.error) throw new Error(statesQuery.error.message)

  const works = (worksQuery.data ?? []) as unknown as (WorkRow & { work_decks?: WorkDeckRow[] })[]
  const { models } = assembleProjectModel({
    works,
    workDecks: works.flatMap((w) => (w.work_decks ?? []).map((wd) => ({ ...wd, work_id: w.id }))),
    decks: (decksQuery.data ?? []) as unknown as DeckRowIn[],
    states: (statesQuery.data ?? []) as unknown as StateRowIn[],
  })
  const index: Record<string, WorkModel[]> = {}
  for (const id of deckIds) {
    index[id] = models.map((m) => ({ ...m, decks: m.decks.filter((d) => d.deck.id === id) }))
  }
  return index
}

/**
 * The foreman's write: where this bay stands in this work, with the note that
 * goes with the change. An upsert on (cell, work) -- the first tick on a bay
 * for a work creates the row -- carrying exactly the columns a non-admin may
 * set plus deck_id, which the RLS policies and the realtime filter read;
 * cell_states_assert_gs_write rejects the whole write if anything else differs.
 *
 * `.select('cell_id')` is load-bearing: PostgREST answers a write RLS filtered
 * out with 204 and no rows, and without asking for them back this function
 * would report success for a write that never happened -- a bay deleted under
 * the tablet, or a project the foreman has just been removed from.
 */
export async function setCellState(
  cellId: string,
  workId: string,
  deckId: string,
  stageId: string | null,
  note = '',
  effort: Effort = EMPTY_EFFORT,
): Promise<void> {
  // The effort (0030) travels in the same statement as the stage, like the
  // note: the guard refuses either moving on its own, and the audit trigger
  // copies both onto the event this write produces.
  const { data, error } = await supabase
    .from('cell_states')
    .upsert(
      {
        cell_id: cellId, work_id: workId, deck_id: deckId, stage_id: stageId, note,
        lead_name: effort.leadName, painter_name: effort.painterName,
        work_hours: effort.workHours, waste_hours: effort.wasteHours, waste_reason: effort.wasteReason,
      },
      { onConflict: 'cell_id,work_id' },
    )
    .select('cell_id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error(`Cell ${cellId} was not updated: it no longer exists, or is no longer writable`)
  }
}

/** A state change as delivered by realtime. */
export interface CellStateChange {
  cellId: string
  workId: string
  stageId: string | null
  note: string
}

/**
 * Keep every tablet on this deck converged on bay states, and on bay deletions.
 *
 * States come from `cell_states` (published with REPLICA IDENTITY FULL by 0024,
 * filtered server side by deck_id). The mesh under them still comes from
 * `cells`: a merge in the deck editor reshapes the survivor (UPDATE) and removes
 * the absorbed bays (DELETE) -- their states go with them by cascade, and the
 * cell DELETE is the one event that names the bay -- and a new bay (INSERT) has
 * to be on the tablet before its first state can land on it.
 */
export function subscribeDeckStates(
  deckId: string,
  handlers: {
    onStateChange: (change: CellStateChange) => void
    /** A bay added or reshaped in the deck editor: geometry only, no state. */
    onCellChange: (cell: Cell) => void
    onCellDelete: (cellId: string) => void
    onStatus: (status: GsRealtimeStatus) => void
  },
): () => void {
  const toChange = (row: Record<string, unknown>): CellStateChange => ({
    cellId: row.cell_id as string,
    workId: row.work_id as string,
    stageId: (row.stage_id as string | null) ?? null,
    note: (row.note as string | null) ?? '',
  })
  const channel = supabase
    .channel(`gs-states-${deckId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'cell_states', filter: `deck_id=eq.${deckId}` },
      (payload) => handlers.onStateChange(toChange(payload.new as Record<string, unknown>)),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'cell_states', filter: `deck_id=eq.${deckId}` },
      (payload) => handlers.onStateChange(toChange(payload.new as Record<string, unknown>)),
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'cells', filter: `deck_id=eq.${deckId}` },
      (payload) => handlers.onCellChange(mapCellRow(payload.new as Record<string, unknown>)),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'cells', filter: `deck_id=eq.${deckId}` },
      (payload) => handlers.onCellChange(mapCellRow(payload.new as Record<string, unknown>)),
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'cells', filter: `deck_id=eq.${deckId}` },
      (payload) => handlers.onCellDelete((payload.old as { id: string }).id),
    )
    .subscribe((status) => {
      handlers.onStatus(
        status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED ? 'subscribed' : 'disconnected',
      )
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}
