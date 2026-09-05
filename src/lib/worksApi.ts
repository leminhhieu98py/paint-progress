import type { Work } from '../domain/types'
import { sumsToOne } from '../domain/weights'
import { supabase } from './supabase'
import { mapWork, type WorkRow } from './workModel'

const WORK_COLUMNS = 'id, project_id, seq, name, kind, weight, counts, manual_progress'

/** A project's works, in seq order. */
export async function listWorks(projectId: string): Promise<Work[]> {
  const { data, error } = await supabase
    .from('works')
    .select(WORK_COLUMNS)
    .eq('project_id', projectId)
    .order('seq')
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as WorkRow[]).map(mapWork)
}

/**
 * Writes a project's whole work list: the rows the admin removed are deleted
 * first, then everything else is upserted by id.
 *
 * The rules are checked here, before any write, as stage weights always have
 * been (saveWorkStages): names and seqs unique, and the weights of the works that
 * COUNT sum to 1 -- unless nothing counts yet, which is a project whose total
 * is simply 0. A work outside the total may carry any weight the admin left
 * on it; it is not in the sum, so it cannot break it.
 */
export async function saveWorks(projectId: string, works: Work[]): Promise<void> {
  const names = new Set(works.map((w) => w.name.trim()))
  if (names.size !== works.length) throw new Error('Work names must be unique')
  const seqs = new Set(works.map((w) => w.seq))
  if (seqs.size !== works.length) throw new Error('Work seq values must be unique')
  const counted = works.filter((w) => w.counts)
  if (counted.length > 0 && !sumsToOne(counted.map((w) => w.weight))) {
    const total = counted.reduce((sum, w) => sum + w.weight, 0)
    throw new Error(`Work weights must sum to 1, got ${total.toFixed(4)}`)
  }

  const existing = await listWorks(projectId)
  const keep = new Set(works.map((w) => w.id))
  const removed = existing.filter((w) => !keep.has(w.id)).map((w) => w.id)
  if (removed.length > 0) {
    const { error } = await supabase.from('works').delete().in('id', removed)
    if (error) throw new Error(error.message)
  }
  if (works.length === 0) return
  const { error } = await supabase.from('works').upsert(
    works.map((w) => ({
      id: w.id,
      project_id: projectId,
      seq: w.seq,
      name: w.name.trim(),
      kind: w.kind,
      weight: w.weight,
      counts: w.counts,
      manual_progress: w.manualProgress,
    })),
    { onConflict: 'id' },
  )
  if (error) throw new Error(error.message)
}

/**
 * Removes a work. The cascade takes its deck weights, its coats on every deck,
 * and every bay's state and note for it; the audit rows keep the work's name
 * and lose only the reference (cell_events.work_id is ON DELETE SET NULL).
 */
export async function deleteWork(workId: string): Promise<void> {
  const { data, error } = await supabase.from('works').delete().eq('id', workId).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error(`Work ${workId} was not deleted: it no longer exists, or is not writable`)
  }
}

export interface WorkDeckWeight {
  deckId: string
  weight: number
}

/** The decks a bays work covers, with the admin's weight for each. */
export async function listWorkDecks(workId: string): Promise<WorkDeckWeight[]> {
  const { data, error } = await supabase
    .from('work_decks')
    .select('deck_id, weight')
    .eq('work_id', workId)
  if (error) throw new Error(error.message)
  return ((data ?? []) as { deck_id: string; weight: string | number }[]).map((r) => ({
    deckId: r.deck_id,
    weight: Number(r.weight),
  }))
}

/**
 * Writes which decks a work covers and at what weight. Decks dropped from the
 * list are removed (their coats and bay states for this work go with them --
 * the UI confirms that); the rest are upserted. Weights sum to 1 unless the
 * list is empty, which is a work nobody has assigned yet.
 */
export async function saveWorkDecks(workId: string, rows: WorkDeckWeight[]): Promise<void> {
  if (rows.length > 0 && !sumsToOne(rows.map((r) => r.weight))) {
    const total = rows.reduce((sum, r) => sum + r.weight, 0)
    throw new Error(`Deck weights must sum to 1, got ${total.toFixed(4)}`)
  }
  const existing = await listWorkDecks(workId)
  const keep = new Set(rows.map((r) => r.deckId))
  const removed = existing.filter((r) => !keep.has(r.deckId)).map((r) => r.deckId)
  if (removed.length > 0) {
    const { error } = await supabase
      .from('work_decks')
      .delete()
      .eq('work_id', workId)
      .in('deck_id', removed)
    if (error) throw new Error(error.message)
  }
  if (rows.length === 0) return
  const { error } = await supabase.from('work_decks').upsert(
    rows.map((r) => ({ work_id: workId, deck_id: r.deckId, weight: r.weight })),
    { onConflict: 'work_id,deck_id' },
  )
  if (error) throw new Error(error.message)
}

/**
 * The deadline for one (work, deck) — Feedback Rv2, item 13 (0031).
 *
 * An UPDATE, not an upsert: the pair already exists (the admin sets a deadline
 * on a deck the work already covers), and an upsert here would need the weight
 * as well and could write a row with weight 0 if it were ever called for a
 * pair that had been removed. Null clears it.
 */
export async function setWorkDeckDeadline(
  workId: string,
  deckId: string,
  deadline: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('work_decks')
    .update({ deadline })
    .eq('work_id', workId)
    .eq('deck_id', deckId)
    .select('deck_id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('Không lưu được hạn: sàn này không còn thuộc công việc đã chọn.')
  }
}

/** The percentage the admin types for a manual work, as a 0..1 fraction. */
export async function setManualProgress(workId: string, value: number): Promise<void> {
  if (!(value >= 0 && value <= 1)) {
    throw new Error('Manual progress must be between 0 and 1')
  }
  const { error } = await supabase.from('works').update({ manual_progress: value }).eq('id', workId)
  if (error) throw new Error(error.message)
}
