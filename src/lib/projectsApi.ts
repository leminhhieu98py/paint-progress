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
 *
 * Sized to `project_stages.weight`, which is `numeric(6,5)` -- scale 5. A
 * three-way split typed as 0.333333 / 0.333333 / 0.333334 sums to exactly 1 and
 * passes any tighter guard, but Postgres stores 0.33333 three times, so on
 * reload the total is 0.99999 and the config that just saved successfully fails
 * its own validation: the banner appears and the Save button disables on a
 * configuration the admin cannot edit their way out of. 1e-5 is the smallest
 * difference scale 5 can express, so the residual the column's own rounding
 * introduces has to be inside it.
 *
 * This is only half the fix. StageConfigPanel clamps what is typed to 5 decimal
 * places so that what is entered is what is stored; without that, a weight can
 * still be silently rounded away under the admin between typing and reload.
 */
export const STAGE_WEIGHT_EPSILON = 1e-5

/**
 * Rounds a weight to what `project_stages.weight` can actually hold.
 *
 * numeric(6,5) is scale 5, and Postgres rounds silently on the way in. Applying
 * the same rounding in the form means the admin sees the value that will be
 * stored, instead of typing a sixth decimal that vanishes between the save and
 * the reload -- which is how a configuration ends up failing the Σ = 1 check it
 * had just passed.
 */
export function roundStageWeight(weight: number): number {
  return Math.round(weight * 1e5) / 1e5
}

export async function createProject(input: { name: string; code: string }): Promise<string> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ name: input.name, code: input.code })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const projectId = (data as { id: string }).id

  // Seed the template so a new project is never left with an empty stage list:
  // reducing over zero stages yields a silent, permanent 0% rather than a
  // crash, which is harder to notice than a failed create.
  const { error: stageError } = await supabase.from('project_stages').insert(
    DEFAULT_STAGE_TEMPLATE.map((s) => ({
      project_id: projectId,
      seq: s.seq,
      name: s.name,
      color: s.color,
      weight: s.weight,
    })),
  )
  if (stageError) {
    // The two inserts are not in a transaction. If the project row committed
    // but the stage seed failed, roll the project back rather than leaving it
    // stranded with zero stages -- the same silent-0% hazard the comment above
    // describes, except now permanent because nothing prompts anyone to retry.
    await supabase.from('projects').delete().eq('id', projectId)
    throw new Error(stageError.message)
  }

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
 * Which stage rows a `saveStages` call would delete, identified by seq.
 *
 * Exposed so the confirmation dialog can name them: a removal is the only part
 * of a stage save that destroys anything, so it is the only part worth
 * confirming, and the dialog must describe the diff rather than guess at it.
 */
export function stagesRemovedBy(
  persisted: Stage[],
  next: Omit<Stage, 'id'>[],
): Stage[] {
  const nextSeqs = new Set(next.map((s) => s.seq))
  return persisted.filter((p) => !nextSeqs.has(p.seq))
}

/** One seq's before-and-after under a `saveStages` call. */
export interface StagePositionChange {
  seq: number
  /** The name the row at this seq holds now, or null if the seq is new. */
  fromName: string | null
  /** The name it will hold, or null if the row at this seq is being deleted. */
  toName: string | null
}

/**
 * What `saveStages` will do to each seq, in seq order.
 *
 * Position by position, because that is how the write works and how the
 * consequences land. `cells.stage_id` and `zones.stage_id` point at stage ROWS,
 * and a seq-keyed upsert never moves a row between seqs -- it rewrites whatever
 * sits at each seq in place. So when the panel renumbers (which it must: every
 * cumulative percentage reads stages by seq, and a gap or a tie corrupts all of
 * them), removing a middle stage or reordering two does not carry the recorded
 * progress along with the name the admin was looking at. It leaves the progress
 * where it is and changes the name over the top of it.
 *
 * Listing the plan by seq is the only framing that says that without lying:
 * "seq 2: Coat 2 -> Tháo giáo" is exactly one UPDATE, and naming the same stage
 * twice -- once as removed, once as moved -- would describe two different
 * database rows with one word.
 *
 * Unchanged seqs are included so the list is the whole plan and can be checked
 * against the table above it, rather than a set of highlights.
 */
export function stageSavePlan(
  persisted: Stage[],
  next: Omit<Stage, 'id'>[],
): StagePositionChange[] {
  const before = new Map(persisted.map((p) => [p.seq, p.name]))
  const after = new Map(next.map((s) => [s.seq, s.name]))
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort((a, b) => a - b)
    .map((seq) => ({
      seq,
      fromName: before.get(seq) ?? null,
      toName: after.get(seq) ?? null,
    }))
}

/**
 * Brings a project's stage list in line with `stages`, keyed by seq.
 *
 * Diff, not replace -- the same medicine syncCells got, for a sharper version of
 * the same reason. `zones.stage_id references project_stages on delete cascade`
 * (0003) and `cells.stage_id ... on delete set null` (0001), so deleting the
 * stage rows and re-inserting them destroyed EVERY zone and every zone_cells
 * link in the project, plus every tick of recorded progress -- on a rename, on a
 * weight tweak, on any save at all. Upserting on (project_id, seq) keeps the
 * stage row and its id, so a rename or a reweight now costs nothing.
 *
 * Only a seq that genuinely disappears is deleted, and that delete does cascade
 * its zones away and null the cells sitting at that stage. That is correct --
 * a zone is a plan for one specific stage and is meaningless without it -- and
 * it is what the caller's confirmation dialog has to describe. Use
 * `stagesRemovedBy` to find out whether there is anything to describe.
 *
 * The Σ = 1 rule is enforced here rather than in the database: it spans rows, so
 * a CHECK constraint cannot express it and a deferred trigger would fire in the
 * middle of a multi-row edit. Validating before any write also means a rejected
 * save leaves the existing stages untouched.
 *
 * Not transactional: the upsert and the delete are separate round trips, so a
 * failure between them leaves the renames applied and the removal not. That is
 * the safe half to lose -- nothing is destroyed -- and closing it needs an RPC.
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

  // Snapshot first: the removals are found by comparing seqs, and after the
  // upsert the rows to remove are indistinguishable from the rows to keep.
  const removed = stagesRemovedBy(await listStages(projectId), stages)

  const { error: upsertError } = await supabase.from('project_stages').upsert(
    stages.map((s) => ({
      project_id: projectId,
      seq: s.seq,
      name: s.name,
      color: s.color,
      weight: s.weight,
    })),
    { onConflict: 'project_id,seq' },
  )
  if (upsertError) throw new Error(upsertError.message)

  // By explicit id, and only when there is something to delete. A
  // `.eq('project_id', projectId)` delete here would be exactly the bug this
  // rewrite exists to remove.
  if (removed.length > 0) {
    const { error: deleteError } = await supabase
      .from('project_stages')
      .delete()
      .in('id', removed.map((r) => r.id))
    if (deleteError) throw new Error(deleteError.message)
  }
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
 * Project names for dropdowns in screens (e.g., UsersScreen). Intentionally
 * lean: no stages, decks, or cells — just the id and name for selector options.
 */
export async function listProjectNames(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }))
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
