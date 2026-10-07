import type { SpoolColumn } from '../../domain/piping/types'
import { supabase } from '../supabase'
import { NOT_SAVED, readAll, requireRows, requiredText, toError, writeOrder } from './shared'

/**
 * The admin's extra text columns on spools (spec §6.1, Q21A). The values live
 * in `piping_spools.extra[label]`, so a rename has to move that key in every
 * spool of the project too -- see renameSpoolColumn.
 */

const COLUMN_SELECT = 'id, label, sort'
const EMPTY_LABEL = 'Tên cột không được để trống'
const duplicateLabel = (label: string) => `Cột "${label}" đã có trong dự án`

/** As the unique index compares labels: lower(btrim()). */
const labelKey = (label: string) => label.trim().toLowerCase()

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
  const text = requiredText(label, EMPTY_LABEL)
  const { data, error } = await supabase
    .from('piping_spool_columns')
    .insert({ project_id: projectId, label: text, sort })
    .select(COLUMN_SELECT)
    .single()
  if (error) throw toError(error, duplicateLabel(text))
  return mapColumn(data as Record<string, unknown>)
}

/** Admin: the column order, as sort 1..n. */
export async function reorderSpoolColumns(orderedIds: string[]): Promise<void> {
  await writeOrder('piping_spool_columns', orderedIds)
}

/**
 * Admin: removes the column. The values stay in the spools' `extra` (data is
 * never dropped as a side effect); nothing shows them while no column has
 * that label, and the next Plan import rewrites `extra` of every spool.
 */
export async function deleteSpoolColumn(id: string): Promise<void> {
  const { data, error } = await supabase.from('piping_spool_columns').delete().eq('id', id).select('id')
  if (error) throw toError(error)
  requireRows(data)
}

/** Spools per UPDATE: the ids go in the URL (`in.(...)`), 100 uuids is about 3.7 kB. */
export const RENAME_CHUNK = 100
const RENAME_CONCURRENCY = 6

export const RENAME_CONFLICT =
  'Dữ liệu spool vừa thay đổi trong lúc đổi tên cột. Tải lại trang rồi đổi tên lại: '
  + 'các spool đã đổi được giữ nguyên, phần còn lại sẽ được đổi tiếp.'

/** Runs the tasks `n` at a time; stops scheduling on the first failure and rethrows it. */
async function runPool(tasks: Array<() => Promise<void>>, n: number): Promise<void> {
  let next = 0
  const failure: { error?: unknown } = {}
  const worker = async () => {
    while (!('error' in failure) && next < tasks.length) {
      const task = tasks[next++]
      try {
        await task()
      } catch (e) {
        if (!('error' in failure)) failure.error = e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker))
  if ('error' in failure) throw failure.error
}

/**
 * Admin: renames a column AND the key of its values in every spool of the
 * project, client-side (no function in 0038 does it; a new migration is out
 * of scope for this task).
 *
 * Order, chosen so a failure part-way is always safe to retry:
 *   1. read the columns: the old label, and a duplicate check against the
 *      others (as the unique index compares);
 *   2. move the key in the spools -- grouped by their whole current `extra`,
 *      one UPDATE per group and 100 ids, each guarded by `extra @> old and
 *      extra <@ old` (equality), so a spool whose extra changed since the read
 *      (an import in another tab) is never overwritten from a stale copy, and
 *      a spool deleted meanwhile is simply not matched;
 *   3. only then rename the column itself.
 * If step 2 stops (an error, or a guard that matched fewer rows than sent),
 * the column still has its old label, the spools already moved keep the new
 * key, and running the rename again moves only the rest. If the new key
 * already exists on a spool (a value left behind by a deleted column), the
 * renamed column's value wins.
 *
 * `onProgress(done, total)` counts spools, for a long rename's progress bar.
 */
export async function renameSpoolColumn(
  projectId: string,
  columnId: string,
  newLabel: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ spoolsUpdated: number }> {
  const next = requiredText(newLabel, EMPTY_LABEL)
  const columns = await listSpoolColumns(projectId)
  const column = columns.find((c) => c.id === columnId)
  if (!column) throw new Error(NOT_SAVED)
  const old = column.label
  if (next === old) return { spoolsUpdated: 0 }
  if (columns.some((c) => c.id !== columnId && labelKey(c.label) === labelKey(next))) {
    throw new Error(duplicateLabel(next))
  }

  const spools = await readAll<{ id: string; extra: unknown }>((a, b) =>
    supabase
      .from('piping_spools')
      .select('id, extra')
      .eq('project_id', projectId)
      .order('id', { ascending: true })
      .range(a, b),
  )

  // Group by the whole current extra: one target object per group.
  const groups = new Map<string, { before: Record<string, unknown>; after: Record<string, unknown>; ids: string[] }>()
  for (const s of spools) {
    const extra = s.extra
    if (!extra || typeof extra !== 'object' || Array.isArray(extra) || !Object.hasOwn(extra, old)) continue
    const before = extra as Record<string, unknown>
    const key = JSON.stringify(before)
    const group = groups.get(key)
    if (group) {
      group.ids.push(s.id)
      continue
    }
    const after = Object.fromEntries(
      Object.entries(before).filter(([k]) => k !== next).map(([k, v]) => [k === old ? next : k, v]),
    )
    groups.set(key, { before, after, ids: [s.id] })
  }

  const total = [...groups.values()].reduce((n, g) => n + g.ids.length, 0)
  let done = 0
  const tasks: Array<() => Promise<void>> = []
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += RENAME_CHUNK) {
      const ids = g.ids.slice(i, i + RENAME_CHUNK)
      tasks.push(async () => {
        const { data, error } = await supabase
          .from('piping_spools')
          .update({ extra: g.after })
          .eq('project_id', projectId)
          .in('id', ids)
          .contains('extra', g.before)
          .containedBy('extra', g.before)
          .select('id')
        if (error) throw toError(error)
        if ((data ?? []).length !== ids.length) throw new Error(RENAME_CONFLICT)
        done += ids.length
        onProgress?.(done, total)
      })
    }
  }
  await runPool(tasks, RENAME_CONCURRENCY)

  const { data, error } = await supabase.from('piping_spool_columns').update({ label: next }).eq('id', columnId).select('id')
  if (error) throw toError(error, duplicateLabel(next))
  requireRows(data)
  return { spoolsUpdated: total }
}
