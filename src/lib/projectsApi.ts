import { computeProjectProgress } from '../domain/progress'
import {
  assembleProjectModel, type DeckRowIn, type StateRowIn, type WorkDeckRow, type WorkRow,
} from './workModel'
import { supabase } from './supabase'
import { DRAWINGS_BUCKET } from './decksApi'

export interface ProjectRow {
  id: string
  name: string
  code: string
  deckCount: number
  /** How many of those decks have a drawing attached. */
  decksWithDrawing: number
  /** Bays across every deck of the project. */
  cellCount: number
  totalAreaM2: number
  progress: number
}

export async function createProject(input: { name: string; code: string }): Promise<string> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ name: input.name, code: input.code })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const projectId = (data as { id: string }).id

  return projectId
}

export async function updateProject(
  id: string,
  input: { name: string; code: string },
): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ name: input.name, code: input.code })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * The project a GS user belongs to, for landing them on their own GS route
 * after sign-in. RLS on `project_members` already restricts a non-admin read
 * to that user's own rows (`user_id = auth.uid()`), so no explicit filter is
 * needed here -- adding one would only be redundant, and screens never call
 * `supabase` directly, so this wrapper is the only way to fetch it.
 *
 * A GS is assigned to at most one project today; `limit(1)` reflects that
 * rather than picking arbitrarily among several.
 */
export async function myFirstProjectId(): Promise<string | null> {
  const { data, error } = await supabase.from('project_members').select('project_id').limit(1)
  if (error) throw new Error(error.message)
  return (data?.[0]?.project_id as string | undefined) ?? null
}

/**
 * Project names for dropdowns in screens (e.g., UsersScreen, DecksScreen).
 * Intentionally lean: no stages, decks, or cells — just id, name and code for
 * selector options. DecksScreen used to fill its project picker from
 * `listProjects`, a four-level embed pulling every stage, deck and cell's
 * area_m2/stage_id for every project in order to read three fields off each
 * row -- on the site tether the admin/GS bundle split exists to protect, that
 * downloads thousands of rows for a `<Select>`.
 */
export async function listProjectNames(): Promise<Array<{ id: string; name: string; code: string }>> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, code')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    code: row.code as string,
  }))
}

export async function listProjects(): Promise<ProjectRow[]> {
  // One query: works with their deck weights, decks with geometry, coats and
  // states. Assembled by the same function every other loader uses.
  const { data, error } = await supabase
    .from('projects')
    .select(
      'id, name, code,'
      + ' works(id, project_id, seq, name, kind, weight, counts, manual_progress, work_decks(deck_id, weight)),'
      + ' decks(id, seq, code, name, total_area_m2, image_path,'
      + ' deck_stages(id, work_id, deck_id, seq, name, color, weight),'
      + ' cells(id, code, area_m2), cell_states(cell_id, work_id, stage_id))',
    )
    .order('name')
  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown>
    const works = (r.works ?? []) as (WorkRow & { work_decks?: WorkDeckRow[] })[]
    const deckRows = (r.decks ?? []) as (DeckRowIn & { cell_states?: StateRowIn[] })[]
    const model = assembleProjectModel({
      works,
      workDecks: works.flatMap((w) => (w.work_decks ?? []).map((wd) => ({ ...wd, work_id: w.id }))),
      decks: deckRows,
      states: deckRows.flatMap((d) => (d.cell_states ?? []).map((st) => ({ ...st, deck_id: d.id }))),
    })

    return {
      id: r.id as string,
      name: r.name as string,
      code: r.code as string,
      deckCount: model.decks.length,
      decksWithDrawing: model.decks.filter((d) => d.imagePath !== null).length,
      cellCount: model.decks.reduce((sum, d) => sum + d.cellCount, 0),
      totalAreaM2: model.decks.reduce((sum, d) => sum + d.totalAreaM2, 0),
      progress: computeProjectProgress(model.models).progress,
    }
  })
}

/**
 * Removes a project and everything under it. The decks' drawing paths are read
 * FIRST: the cascade takes the decks with the project row, and with them the
 * only record of which files in the bucket are this project's. Then the row,
 * then one storage call for every path.
 *
 * Same failure policy as decksApi.deleteDeck, for the same reason: a refused
 * delete throws before storage is touched; files that could not be removed
 * after a delete that has happened are counted and returned, never thrown.
 */
export async function deleteProject(
  projectId: string,
): Promise<{ drawingsRemoved: number; drawingsTotal: number }> {
  const { data: decks, error: listError } = await supabase
    .from('decks')
    .select('image_path')
    .eq('project_id', projectId)
  if (listError) throw new Error(listError.message)
  const paths = ((decks ?? []) as { image_path: string | null }[])
    .map((d) => d.image_path)
    .filter((p): p is string => p !== null)

  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) throw new Error(error.message)

  if (paths.length === 0) return { drawingsRemoved: 0, drawingsTotal: 0 }
  const { error: storageError } = await supabase.storage.from(DRAWINGS_BUCKET).remove(paths)
  return { drawingsRemoved: storageError ? 0 : paths.length, drawingsTotal: paths.length }
}
