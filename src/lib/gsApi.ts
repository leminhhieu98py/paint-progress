import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import type { Cell, Stage } from '../domain/types'
import { listStages } from './projectsApi'
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
  stages: Stage[]
  decks: GsDeck[]
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
 * The project's stage configuration and its decks, in one round trip pair.
 *
 * Stages come from projectsApi.listStages: the mapping is identical for both
 * roles, and two copies of it would let the admin's percentages and the GS's
 * disagree after any change to the row shape.
 */
export async function loadGsProject(projectId: string): Promise<GsProject> {
  const [stages, decksResult] = await Promise.all([
    listStages(projectId),
    supabase
      .from('decks')
      .select('id, seq, name, code, image_path, image_w, image_h, total_area_m2, area_source')
      .eq('project_id', projectId)
      .order('seq'),
  ])
  if (decksResult.error) throw new Error(decksResult.error.message)

  return {
    stages,
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
  const { error } = await supabase.from('cells').update({ stage_id: stageId }).eq('id', cellId)
  if (error) throw new Error(error.message)
}

/**
 * Keep every client on this deck converged (spec §11 row 3: last write wins on
 * cells.stage_id, and cell_events retains the full history so nothing is lost).
 *
 * Per deck, filtered server side: an unfiltered subscription would fold another
 * deck's cells into this one's list and therefore into its percentages.
 *
 * DELETE is deliberately not subscribed. Under the default replica identity a
 * delete's payload carries only the primary key, and a filter on deck_id cannot
 * match it, so the binding would be dead code. The consequence is recorded in
 * the Phase 3 carry-over: an admin deleting a cell while a GS watches leaves a
 * stale cell on the drawing until the next deck switch or refetch.
 */
export function subscribeDeckCells(
  deckId: string,
  handlers: {
    onCellChange: (cell: Cell) => void
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
