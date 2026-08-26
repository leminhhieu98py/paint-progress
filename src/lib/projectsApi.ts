import type { Cell, Deck } from '../domain/types'
import { computeProjectProgress } from '../domain/progress'
import { supabase } from './supabase'

export interface ProjectRow {
  id: string
  name: string
  code: string
  deckCount: number
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
  const { data, error } = await supabase
    .from('projects')
    .select(
      'id, name, code, decks(id, code, name, total_area_m2, deck_stages(id, seq, name, color, weight), cells(id, code, area_m2, stage_id))',
    )
    .order('name')
  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    // Each deck carries its own stages: their weights sum to 1 within the deck,
    // so a project percentage is a weighted average of per-deck percentages,
    // not one sum over one stage list.
    const entries = ((row.decks ?? []) as Record<string, unknown>[]).map((d) => ({
      stages: ((d.deck_stages ?? []) as Record<string, unknown>[]).map((s2) => ({
        id: s2.id as string,
        seq: s2.seq as number,
        name: s2.name as string,
        color: s2.color as string,
        weight: Number(s2.weight),
      })),
      deck: {
        id: d.id as string,
        code: d.code as string,
        name: d.name as string,
        totalAreaM2: Number(d.total_area_m2),
        // The rollup only needs areaM2 and stageId to compute one percentage per
        // project; fetching normalized x/y/w/h for every cell of every deck here
        // would move a lot of data for nothing. The deck editor loads real
        // geometry separately when it actually needs to draw the cells.
        cells: ((d.cells ?? []) as Record<string, unknown>[]).map(
          (c): Cell => ({
            id: c.id as string,
            code: c.code as string,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            areaM2: Number(c.area_m2),
            stageId: (c.stage_id as string | null) ?? null,
          }),
        ),
      } satisfies Deck,
    }))

    return {
      id: row.id as string,
      name: row.name as string,
      code: row.code as string,
      deckCount: entries.length,
      totalAreaM2: entries.reduce((sum, e) => sum + e.deck.totalAreaM2, 0),
      progress: computeProjectProgress(entries).progress,
    }
  })
}
