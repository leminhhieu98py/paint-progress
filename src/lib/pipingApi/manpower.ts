import type { DayKey, ManpowerActualValue, ManpowerGroup, ManpowerValue } from '../../domain/piping/types'
import { supabase } from '../supabase'
import {
  MAX_ROWS, TOO_MANY_ROWS, callRpc, importResult, isDayKey, nameOf, readAll, requireRows, requiredText, toError,
  toNumber, writeOrder, type PipingImportResult,
} from './shared'

/**
 * Manpower (spec §5): the admin's crew groups (add, rename, hide, reorder,
 * delete while unused -- R-6), the plan (replaced by import) and the actual
 * cells (piping_set_manpower_actual for everyone: GS fill empty cells, the
 * admin overwrites, and a null from the admin deletes).
 */

/** An actual cell with the names behind its stamps (null when RLS hides the profile). */
export interface ManpowerActualEntry extends ManpowerActualValue {
  createdByName: string | null
  editedByName: string | null
}

const GROUP_SELECT = 'id, name, sort, hidden'
const EMPTY_NAME = 'Tên nhóm không được để trống'
const duplicateName = (name: string) => `Nhóm "${name}" đã có trong dự án`

function mapGroup(r: Record<string, unknown>): ManpowerGroup {
  return { id: r.id as string, name: r.name as string, sort: Number(r.sort), hidden: r.hidden === true }
}

/** Every group of the project, hidden ones included (their history still shows, R-8), by sort. */
export async function listManpowerGroups(projectId: string): Promise<ManpowerGroup[]> {
  const rows = await readAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('piping_manpower_groups')
      .select(GROUP_SELECT)
      .eq('project_id', projectId)
      .order('sort', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  )
  return rows.map(mapGroup)
}

/** Admin: a new group at `sort` (the caller puts it last). Names are unique per project, case- and space-blind. */
export async function addManpowerGroup(projectId: string, name: string, sort: number): Promise<ManpowerGroup> {
  const text = requiredText(name, EMPTY_NAME)
  const { data, error } = await supabase
    .from('piping_manpower_groups')
    .insert({ project_id: projectId, name: text, sort })
    .select(GROUP_SELECT)
    .single()
  if (error) throw toError(error, duplicateName(text))
  return mapGroup(data as Record<string, unknown>)
}

/** Admin: renames a group. Plan/actual rows key on the id, so nothing else changes. */
export async function renameManpowerGroup(id: string, name: string): Promise<void> {
  const text = requiredText(name, EMPTY_NAME)
  const { data, error } = await supabase.from('piping_manpower_groups').update({ name: text }).eq('id', id).select('id')
  if (error) throw toError(error, duplicateName(text))
  requireRows(data)
}

/** Admin: hides or shows a group in the entry forms. */
export async function setManpowerGroupHidden(id: string, hidden: boolean): Promise<void> {
  const { data, error } = await supabase.from('piping_manpower_groups').update({ hidden }).eq('id', id).select('id')
  if (error) throw toError(error)
  requireRows(data)
}

/** Admin: the drag order (ORD-01), as sort 1..n. */
export async function reorderManpowerGroups(orderedIds: string[]): Promise<void> {
  await writeOrder('piping_manpower_groups', orderedIds)
}

/**
 * Admin: deletes an unused group. A group with any plan or actual row is
 * refused by the table's guard ('Nhóm "N" đã có dữ liệu, không xoá được --
 * hãy ẩn nhóm'), passed through as is.
 */
export async function deleteManpowerGroup(id: string): Promise<void> {
  const { data, error } = await supabase.from('piping_manpower_groups').delete().eq('id', id).select('id')
  if (error) throw toError(error)
  requireRows(data)
}

/** The whole plan. Paged: up to 20 000 days times the group count. */
export async function listManpowerPlan(projectId: string): Promise<ManpowerValue[]> {
  const rows = await readAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('piping_manpower_plan')
      .select('group_id, day, value')
      .eq('project_id', projectId)
      // (group_id, day) is the primary key: total.
      .order('day', { ascending: true })
      .order('group_id', { ascending: true })
      .range(a, b),
  )
  return rows.map((r) => ({ groupId: r.group_id as string, day: r.day as string, value: toNumber(r.value) }))
}

/**
 * Replaces the whole plan in one transaction and logs it. Admin only. One
 * value per filled cell; an empty cell is no value. The 20 000 limit is on
 * the file's rows, i.e. distinct days.
 */
export async function replaceManpowerPlan(
  projectId: string,
  values: ManpowerValue[],
  fileName: string,
  summary: Record<string, unknown> = {},
): Promise<PipingImportResult> {
  if (new Set(values.map((v) => v.day)).size > MAX_ROWS) throw new Error(TOO_MANY_ROWS)
  const data = await callRpc<unknown>('piping_replace_manpower_plan', {
    p_project: projectId,
    p_rows: values.map((v) => ({ group_id: v.groupId, day: v.day, value: v.value })),
    p_file_name: fileName,
    p_summary: summary,
  })
  return importResult(data)
}

const ACTUAL_SELECT =
  'group_id, day, value, created_by, created_at, edited_by, edited_at,'
  + ' creator:profiles!piping_manpower_actual_created_by_fkey(full_name),'
  + ' editor:profiles!piping_manpower_actual_edited_by_fkey(full_name)'

/** Every actual cell. Paged. */
export async function listManpowerActual(projectId: string): Promise<ManpowerActualEntry[]> {
  const rows = await readAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('piping_manpower_actual')
      .select(ACTUAL_SELECT)
      .eq('project_id', projectId)
      .order('day', { ascending: true })
      .order('group_id', { ascending: true })
      .range(a, b),
  )
  return rows.map((r) => ({
    groupId: r.group_id as string,
    day: r.day as string,
    value: toNumber(r.value),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    editedBy: (r.edited_by as string | null) ?? null,
    editedAt: (r.edited_at as string | null) ?? null,
    createdByName: nameOf(r.creator),
    editedByName: nameOf(r.editor),
  }))
}

/** One group's value for the day; null = leave empty (GS) or delete (admin). */
export interface ManpowerActualInput {
  groupId: string
  value: number | null
}

/**
 * Writes one day's cells and returns how many rows changed. GS: fills empty
 * cells only (a different value where one exists, or a hidden group, raises
 * in Vietnamese); admin: inserts, overwrites, and deletes on null.
 */
export async function setManpowerActual(projectId: string, day: DayKey, values: ManpowerActualInput[]): Promise<number> {
  if (!isDayKey(day)) throw new Error('Thiếu ngày')
  if (values.some((v) => v.value !== null && !(Number.isFinite(v.value) && v.value >= 0))) {
    throw new Error('Giá trị nhân lực phải lớn hơn hoặc bằng 0')
  }
  const touched = await callRpc<number>('piping_set_manpower_actual', {
    p_project: projectId,
    p_day: day,
    p_values: values.map((v) => ({ group_id: v.groupId, value: v.value })),
  })
  return Number(touched ?? 0)
}
