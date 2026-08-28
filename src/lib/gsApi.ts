import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import type { Cell } from '../domain/types'
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
    .select('id, code, x, y, w, h, area_m2, stage_id')
    .eq('deck_id', deckId)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? []).map((c) => mapCellRow(c as Record<string, unknown>))
}

/**
 * Record which coat a bay has reached. The only write the GS screen makes.
 *
 * The payload is stage_id and nothing else, and that is a hard requirement, not
 * tidiness: cells_assert_gs_stage_only (0006/0007/0008/0013) rejects the entire
 * UPDATE if id, deck_id, code, x, y, w, h, area_m2, updated_at or updated_by
 * differs from the stored row, with `only stage_id may be changed by a
 * non-admin`. updated_at and updated_by are stamped by
 * set_cell_audit_columns from now() and auth.uid(); a client that sends its own
 * is refused, by design (0013).
 */
export async function setCellStage(cellId: string, stageId: string | null): Promise<void> {
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
    .update({ stage_id: stageId })
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
