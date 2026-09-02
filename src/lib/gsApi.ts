import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import type { Cell, Stage } from '../domain/types'
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
export async function listDeckCells(deckId: string): Promise<Cell[]> {
  const { data, error } = await supabase
    .from('cells')
    .select('id, code, x, y, w, h, area_m2, stage_id, note')
    .eq('deck_id', deckId)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? []).map((c) => mapCellRow(c as Record<string, unknown>))
}

/** One deck's bays and its own coat list, both trimmed to what a percentage needs. */
export interface DeckProgressInput {
  cells: { areaM2: number; stageId: string | null }[]
  stages: Stage[]
}

/**
 * Just enough of every deck to put a percentage on its tab.
 *
 * Two round trips for the whole project: the bays' areas and stages, and the
 * decks' own coat lists. The tabs used to carry the name alone, on the
 * reasoning that a per-deck figure would mean the heaviest read in the app once
 * per deck on a site tether -- true of `listDeckCells`, which pulls geometry
 * and notes as well, and false of this.
 *
 * It matters on the tablet because the foreman picks a deck to work on, and
 * "which one is behind" is the question he picks by. Without a figure the tabs
 * are names in an order nobody chose.
 *
 * The coats are read PER DECK and never shared. Each deck declares its own
 * stage list with its own ids (spec §3.1), so scoring one deck's bays against
 * another's stages counts every bay as not started -- a deck 37% along reported
 * 0% on the tab the foreman was choosing by, which is the defect this shape
 * exists to make impossible: cells and stages arrive together, per deck, or not
 * at all.
 *
 * Grouped here rather than in SQL: PostgREST has no GROUP BY, and the weighted
 * percentage is computeDeckProgress's to work out anyway -- doing half of it in
 * the database would put spec §3.2's denominator rule in two places.
 */
export async function listProjectStageIndex(
  deckIds: string[],
): Promise<Record<string, DeckProgressInput>> {
  if (deckIds.length === 0) return {}

  const cellsQuery = await supabase
    .from('cells')
    .select('deck_id, area_m2, stage_id')
    .in('deck_id', deckIds)
  if (cellsQuery.error) throw new Error(cellsQuery.error.message)

  const stagesQuery = await supabase
    .from('deck_stages')
    .select('deck_id, id, seq, name, color, weight')
    .in('deck_id', deckIds)
    .order('seq')
  if (stagesQuery.error) throw new Error(stagesQuery.error.message)

  // Every requested deck gets an entry, including one with no bays and no
  // coats. The caller divides by these; a missing key would throw on the tab
  // rather than read 0%.
  const index: Record<string, DeckProgressInput> = {}
  for (const id of deckIds) index[id] = { cells: [], stages: [] }

  for (const row of (cellsQuery.data ?? []) as Record<string, unknown>[]) {
    const entry = index[row.deck_id as string]
    if (!entry) continue
    entry.cells.push({
      areaM2: Number(row.area_m2),
      stageId: (row.stage_id as string | null) ?? null,
    })
  }
  for (const row of (stagesQuery.data ?? []) as Record<string, unknown>[]) {
    const entry = index[row.deck_id as string]
    if (!entry) continue
    entry.stages.push({
      id: row.id as string,
      seq: row.seq as number,
      name: row.name as string,
      color: row.color as string,
      weight: Number(row.weight),
    })
  }
  // `.order('seq')` sorts the result set, not each deck's slice of it, and
  // cumulative progress reads coats in seq ORDER.
  for (const id of deckIds) index[id].stages.sort((a, b) => a.seq - b.seq)

  return index
}

/**
 * Record which coat a bay has reached. The only write the GS screen makes.
 *
 * The payload is stage_id and note and nothing else, and that is a hard
 * requirement, not tidiness: cells_assert_gs_stage_only (0006/0007/0008/0013,
 * widened by 0019) rejects the entire UPDATE if id, deck_id, code, x, y, w, h,
 * area_m2, updated_at or updated_by differs from the stored row, with `only
 * stage_id and note may be changed by a non-admin`. updated_at and updated_by
 * are stamped by set_cell_audit_columns from now() and auth.uid(); a client
 * that sends its own is refused, by design (0013).
 *
 * The note goes in the SAME statement as the stage, and 0019's guard refuses a
 * note that arrives without one. That is what makes cell_events a complete
 * record of every note: its trigger fires on a stage change, so a note written
 * separately would land on the cell with nothing in the history naming who
 * wrote it.
 *
 * It is always sent, empty included. A bay that gets a new coat and no comment
 * must not keep the note that explained the coat before it.
 */
export async function setCellStage(
  cellId: string,
  stageId: string | null,
  note = '',
): Promise<void> {
  // `.select('id')` is load-bearing, not decoration. PostgREST answers an
  // UPDATE that matches ZERO rows with 204 and no error, so without asking for
  // the affected rows back this function cannot tell "written" from "matched
  // nothing" -- and it reports success either way. Both no-match paths are
  // reachable from a tablet: an admin deletes or merges the cell while the
  // foreman has the deck open, or the GS's project_members row is removed
  // mid-shift, after which the RLS USING clause filters the row out -- which is
  // a zero-row update, not an error. Left unchecked the optimistic value stays
  // on screen, the pie and both spec-table rows move, and the database never
  // changed.
  //
  // The delete binding added for 0016 narrows the first path but does not close
  // it: the DELETE and the tap still race, and a tablet whose socket is down --
  // the state the staleness banner exists for -- keeps the removed bay on its
  // drawing and tappable. This check is what turns that into an error the
  // foreman sees instead of a phantom write.
  const { data, error } = await supabase
    .from('cells')
    .update({ stage_id: stageId, note })
    .eq('id', cellId)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error(`Cell ${cellId} was not updated: it no longer exists, or is no longer readable`)
  }
}

/**
 * Keep every client on this deck converged (spec §11 row 3: last write wins on
 * cells.stage_id, and cell_events retains the full history so nothing is lost).
 *
 * Per deck, filtered server side: an unfiltered subscription would fold another
 * deck's cells into this one's list and therefore into its percentages.
 *
 * DELETE is subscribed, and depends on migration 0016. A merge in the admin's
 * deck editor is ONE update of the survivor to the union area plus a DELETE of
 * each absorbed cell (mergeCells keeps `topLeft.code`), so without the delete
 * binding the survivor grows on the foreman's tablet while the absorbed cells
 * stay -- their area counted twice in every A_i, and therefore in the number the
 * customer is billed against, until the foreman happens to change tab. The
 * binding needs `replica identity full`: measured against the live project, with
 * the default identity BOTH a deck_id-filtered DELETE binding and an unfiltered
 * one received nothing, because the old record carries only the primary key and
 * Realtime cannot evaluate cells_member_read without deck_id. Do not "simplify"
 * 0016 away on the theory that the filter was the problem.
 *
 * The DELETE callback reads `payload.old`, not `payload.new`: Realtime sends the
 * removed row as the old record and leaves `new` an empty object.
 */
export function subscribeDeckCells(
  deckId: string,
  handlers: {
    onCellChange: (cell: Cell) => void
    onCellDelete: (cellId: string) => void
    onStatus: (status: GsRealtimeStatus) => void
  },
): () => void {
  const channel = supabase
    .channel(`gs-cells-${deckId}`)
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
      // Compared against the enum member, not the string 'SUBSCRIBED': the
      // callback's parameter is typed as the REALTIME_SUBSCRIBE_STATES enum, and
      // TypeScript rejects comparing a string enum to a string literal (TS2367).
      // Do not "simplify" this back to a literal.
      handlers.onStatus(
        status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED ? 'subscribed' : 'disconnected',
      )
    })

  return () => {
    void supabase.removeChannel(channel)
  }
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
