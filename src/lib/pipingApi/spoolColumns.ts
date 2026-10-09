import { builtInSpoolHeader } from '../../domain/piping/imports'
import type { SpoolColumn } from '../../domain/piping/types'
import { supabase } from '../supabase'
import { callRpc, readAll, requiredText, toError } from './shared'

/**
 * The admin's extra text columns on spools (spec §6.1, Q21A). The values live
 * in `piping_spools.extra[label]`, so a rename or a delete has to move or
 * strip that key in every spool of the project too (the 0039 functions).
 */

const COLUMN_SELECT = 'id, label, sort'
const EMPTY_LABEL = 'Tên cột không được để trống'
const duplicateLabel = (label: string) => `Cột "${label}" đã có trong dự án`

/**
 * Trimmed and non-blank, and not a built-in spool header (SpoolNo, LineNo,
 * the Plan/Actual columns and their aliases): a file could not tell the two
 * apart. Duplicates are the database's (unique index, and the rename
 * function's own message); the built-in list lives only in the import code.
 */
function checkLabel(label: string): string {
  const text = requiredText(label, EMPTY_LABEL)
  const builtIn = builtInSpoolHeader(text)
  if (builtIn) throw new Error(`Tên cột "${text}" trùng tên cột chuẩn ${builtIn}`)
  return text
}

function mapColumn(r: Record<string, unknown>): SpoolColumn {
  return { id: r.id as string, label: r.label as string, sort: Number(r.sort) }
}

export async function listSpoolColumns(projectId: string): Promise<SpoolColumn[]> {
  const rows = await readAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('piping_spool_columns')
      .select(COLUMN_SELECT)
      .eq('project_id', projectId)
      .order('sort', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  )
  return rows.map(mapColumn)
}

/** Admin: a new column at `sort` (the caller puts it last). */
export async function addSpoolColumn(projectId: string, label: string, sort: number): Promise<SpoolColumn> {
  const text = checkLabel(label)
  const { data, error } = await supabase
    .from('piping_spool_columns')
    .insert({ project_id: projectId, label: text, sort })
    .select(COLUMN_SELECT)
    .single()
  if (error) throw toError(error, { unique: duplicateLabel(text) })
  return mapColumn(data as Record<string, unknown>)
}

/**
 * Admin: the column order, as sort 1..n in one transaction (piping_reorder,
 * 0039). `orderedIds` must be every column of the project; a stale list is
 * refused ('Danh sách đã thay đổi, ...').
 */
export async function reorderSpoolColumns(projectId: string, orderedIds: string[]): Promise<void> {
  await callRpc<number>('piping_reorder', { p_project: projectId, p_kind: 'column', p_ids: orderedIds })
}

/**
 * Admin: deletes the column AND strips its key from every spool of the
 * project, in one transaction (piping_delete_spool_column, 0039), so no value
 * outlives its column and none can resurface under a column added later with
 * the same label. Returns the number of spools changed.
 */
export async function deleteSpoolColumn(projectId: string, columnId: string): Promise<{ spoolsUpdated: number }> {
  const n = await callRpc<number>('piping_delete_spool_column', { p_project: projectId, p_column: columnId })
  return { spoolsUpdated: Number(n ?? 0) }
}

/**
 * Admin: renames a column AND moves the key of its values in every spool of
 * the project, in one transaction (piping_rename_spool_column, 0039). The new
 * label becomes authoritative: any older value under it (any letter case) is
 * dropped from every spool first, so a spool without the old value ends with
 * none under the new label. Returns the number of spools changed; 0 when the
 * trimmed label is unchanged.
 */
export async function renameSpoolColumn(
  projectId: string,
  columnId: string,
  newLabel: string,
): Promise<{ spoolsUpdated: number }> {
  const text = checkLabel(newLabel)
  const n = await callRpc<number>(
    'piping_rename_spool_column',
    { p_project: projectId, p_column: columnId, p_label: text },
    { unique: duplicateLabel(text) },
  )
  return { spoolsUpdated: Number(n ?? 0) }
}
