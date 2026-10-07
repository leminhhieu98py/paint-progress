import type { DayKey, ReinstatementActualEntry, ReinstatementPlanRow } from '../../domain/piping/types'
import { supabase } from '../supabase'
import {
  MAX_ROWS, TOO_MANY_ROWS, callRpc, importResult, isDayKey, nameOf, readAll, requireRows, toError, toNumber,
  type PipingImportResult,
} from './shared'

/**
 * Reinstatement (spec §4): the plan (one quantity per day, replaced as a
 * whole by the admin's import) and the append-only actual entries (GS through
 * piping_add_reinstatement; the admin edits and deletes directly, the table's
 * trigger holding the future-day rule and the Test Pack cap for her too).
 */

/** An entry with the names of who wrote and who last edited it (null when RLS hides the profile). */
export interface ReinstatementEntry extends ReinstatementActualEntry {
  createdByName: string | null
  editedByName: string | null
}

/** The whole plan, by day. Paged: up to 20 000 rows. */
export async function listReinstatementPlan(projectId: string): Promise<ReinstatementPlanRow[]> {
  const rows = await readAll<{ day: string; plan_qty: unknown }>((a, b) =>
    supabase
      .from('piping_reinstatement_plan')
      .select('day, plan_qty')
      .eq('project_id', projectId)
      // (project_id, day) is the primary key: day alone is total here.
      .order('day', { ascending: true })
      .range(a, b),
  )
  return rows.map((r) => ({ day: r.day, planQty: toNumber(r.plan_qty) }))
}

/**
 * Replaces the whole plan in one transaction and logs the import. Admin only.
 * `summary` is the client's own note for the log (an object); the function
 * merges its counts (rows, added, changed, removed) into it.
 */
export async function replaceReinstatementPlan(
  projectId: string,
  rows: ReinstatementPlanRow[],
  fileName: string,
  summary: Record<string, unknown> = {},
): Promise<PipingImportResult> {
  if (rows.length > MAX_ROWS) throw new Error(TOO_MANY_ROWS)
  const data = await callRpc<unknown>('piping_replace_reinstatement_plan', {
    p_project: projectId,
    p_rows: rows.map((r) => ({ day: r.day, plan_qty: r.planQty })),
    p_file_name: fileName,
    p_summary: summary,
  })
  return importResult(data)
}

const ENTRY_SELECT =
  'id, day, qty, created_by, created_at, edited_by, edited_at,'
  + ' creator:profiles!piping_reinstatement_actual_created_by_fkey(full_name),'
  + ' editor:profiles!piping_reinstatement_actual_edited_by_fkey(full_name)'

/** Every actual entry, oldest day first. Paged. */
export async function listReinstatementEntries(projectId: string): Promise<ReinstatementEntry[]> {
  const rows = await readAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('piping_reinstatement_actual')
      .select(ENTRY_SELECT)
      .eq('project_id', projectId)
      .order('day', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  )
  return rows.map((r) => ({
    id: r.id as string,
    day: r.day as string,
    qty: toNumber(r.qty),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    editedBy: (r.edited_by as string | null) ?? null,
    editedAt: (r.edited_at as string | null) ?? null,
    createdByName: nameOf(r.creator),
    editedByName: nameOf(r.editor),
  }))
}

function checkEntry(day: DayKey, qty: number): void {
  if (!isDayKey(day)) throw new Error('Thiếu ngày')
  if (!(Number.isFinite(qty) && qty > 0)) throw new Error('Số lượng phải lớn hơn 0')
}

/**
 * Appends one entry (GS of the project or admin) and returns its id. The
 * function refuses a future day and the Test Pack cap in Vietnamese
 * ("Vượt tổng Test Pack (đã có X / Y)", "Admin chưa nhập tổng Test Pack").
 */
export async function addReinstatementEntry(projectId: string, day: DayKey, qty: number): Promise<string> {
  checkEntry(day, qty)
  return callRpc<string>('piping_add_reinstatement', { p_project: projectId, p_day: day, p_qty: qty })
}

/** Admin: corrects an entry. Stamped edited_by/at by the trigger, which also holds the cap. */
export async function updateReinstatementEntry(id: string, patch: { day: DayKey; qty: number }): Promise<void> {
  checkEntry(patch.day, patch.qty)
  const { data, error } = await supabase
    .from('piping_reinstatement_actual')
    .update({ day: patch.day, qty: patch.qty })
    .eq('id', id)
    .select('id')
  if (error) throw toError(error)
  requireRows(data)
}

/** Admin: removes an entry. */
export async function deleteReinstatementEntry(id: string): Promise<void> {
  const { data, error } = await supabase.from('piping_reinstatement_actual').delete().eq('id', id).select('id')
  if (error) throw toError(error)
  requireRows(data)
}
