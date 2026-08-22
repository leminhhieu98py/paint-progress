import { DEFAULT_STAGE_TEMPLATE } from '../domain/stageTemplate'
import type { Cell, Deck, Stage } from '../domain/types'
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

/**
 * Weights are entered as decimals in a form, so an exact === 1 test would
 * reject 0.1+0.1+0.1+0.7. Compare within this instead.
 */
export const STAGE_WEIGHT_EPSILON = 1e-6

export async function createProject(input: { name: string; code: string }): Promise<string> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ name: input.name, code: input.code })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const projectId = (data as { id: string }).id

  // Seed the template so a new project is never left with an empty stage list,
  // which would make every progress percentage undefined.
  const { error: stageError } = await supabase.from('project_stages').insert(
    DEFAULT_STAGE_TEMPLATE.map((s) => ({
      project_id: projectId,
      seq: s.seq,
      name: s.name,
      color: s.color,
      weight: s.weight,
    })),
  )
  if (stageError) throw new Error(stageError.message)

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

export async function listStages(projectId: string): Promise<Stage[]> {
  const { data, error } = await supabase
    .from('project_stages')
    .select('id, seq, name, color, weight')
    .eq('project_id', projectId)
    .order('seq')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    seq: r.seq as number,
    name: r.name as string,
    color: r.color as string,
    weight: Number(r.weight),
  }))
}

/**
 * Replaces a project's stage list wholesale.
 *
 * The Σ = 1 rule is enforced here rather than in the database: it spans rows, so
 * a CHECK constraint cannot express it and a deferred trigger would fire in the
 * middle of a multi-row edit. Validating before any write also means a rejected
 * save leaves the existing stages untouched.
 *
 * `cells.stage_id` references `project_stages` with `on delete set null`, so
 * deleting and reinserting the stage list nulls every cell's stage for this
 * project -- every tick of recorded progress. That is acceptable during Phase 2
 * authoring, before any progress exists, but do not call this casually once GS
 * users have started painting.
 */
export async function saveStages(
  projectId: string,
  stages: Omit<Stage, 'id'>[],
): Promise<void> {
  if (stages.length === 0) {
    throw new Error('A project needs at least one stage')
  }
  const seqs = new Set(stages.map((s) => s.seq))
  if (seqs.size !== stages.length) {
    throw new Error('Stage seq values must be unique')
  }
  const total = stages.reduce((sum, s) => sum + s.weight, 0)
  if (Math.abs(total - 1) > STAGE_WEIGHT_EPSILON) {
    throw new Error(`Stage weights must sum to 1, got ${total.toFixed(4)}`)
  }

  const { error: deleteError } = await supabase
    .from('project_stages')
    .delete()
    .eq('project_id', projectId)
  if (deleteError) throw new Error(deleteError.message)

  const { error: insertError } = await supabase.from('project_stages').insert(
    stages.map((s) => ({
      project_id: projectId,
      seq: s.seq,
      name: s.name,
      color: s.color,
      weight: s.weight,
    })),
  )
  if (insertError) throw new Error(insertError.message)
}

export async function listProjects(): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(
      'id, name, code, project_stages(id, seq, name, color, weight), decks(id, code, name, total_area_m2, cells(id, code, area_m2, stage_id))',
    )
    .order('name')
  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const stages: Stage[] = ((row.project_stages ?? []) as Record<string, unknown>[])
      .map((s) => ({
        id: s.id as string,
        seq: s.seq as number,
        name: s.name as string,
        color: s.color as string,
        weight: Number(s.weight),
      }))
      .sort((a, b) => a.seq - b.seq)

    const decks: Deck[] = ((row.decks ?? []) as Record<string, unknown>[]).map((d) => ({
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
    }))

    return {
      id: row.id as string,
      name: row.name as string,
      code: row.code as string,
      deckCount: decks.length,
      totalAreaM2: decks.reduce((sum, d) => sum + d.totalAreaM2, 0),
      progress: computeProjectProgress(decks, stages).progress,
    }
  })
}
