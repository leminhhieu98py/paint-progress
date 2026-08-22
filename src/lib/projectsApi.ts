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
 * Which stage rows a `saveStages` call would delete, identified by id.
 *
 * By id, because that is what identity is: the draft carries every surviving
 * stage's id, so a row missing from it is a row the admin actually removed --
 * no matter how the seqs were renumbered around it. A seq-keyed version of this
 * function named the wrong stage on exactly the edit that matters most: remove
 * the middle of three and the panel renumbers to 1, 2, so the seq that
 * disappears is 3, and the dialog announced the deletion of the last stage while
 * the database deleted the middle one.
 *
 * Exposed so the confirmation dialog can name them: a removal is the only part
 * of a stage save that destroys anything, so it is the only part worth
 * confirming, and the dialog must describe the diff rather than guess at it.
 * The names come from the persisted rows -- what the database is about to
 * delete -- not from the draft, which no longer holds these rows at all.
 */
export function stagesRemovedBy(persisted: Stage[], next: Stage[]): Stage[] {
  const nextIds = new Set(next.map((s) => s.id))
  return persisted.filter((p) => !nextIds.has(p.id))
}

/**
 * Brings a project's stage list in line with `stages`, keyed by id.
 *
 * Identity is the stage's id; `seq` is display order and nothing more. That
 * distinction is the whole point of this function. `cells.stage_id` and
 * `zones.stage_id` point at stage ROWS, while the panel renumbers seq 1..n on
 * every structural change (cumulative progress reads stages in seq ORDER, so a
 * tie corrupts every percentage -- two stages at one seq each count the other's
 * cells -- while a gap costs nothing at all: see the write order below). An
 * upsert keyed on (project_id, seq) therefore never moved a row between seqs --
 * it rewrote whatever row sat at each seq in place. Clicking "Lên" on Coat 3
 * rewrote the row where Coat 2's
 * progress was recorded, and every cell recorded at Coat 2 was thereafter
 * counted as Coat 3: a later, heavier stage, so the deck's reported percentage
 * rose with nothing deleted and nothing on screen to explain it. Keyed on id, a
 * rename, a reweight and a reorder all preserve every row's id, so every
 * cells.stage_id and every zones.stage_id keeps pointing at the stage the admin
 * meant, and nothing cascades.
 *
 * Every stage passed in must already carry an id: StageConfigPanel mints one
 * with crypto.randomUUID() the moment the admin adds a row, so a new stage is an
 * INSERT of a known id rather than something this function has to match up
 * afterwards. The ids of existing stages come from `listStages`, so they are the
 * database's own.
 *
 * A reorder swaps seq between two rows inside one statement, which the immediate
 * `unique (project_id, seq)` from 0001 rejected row by row. Migration 0012 makes
 * it `deferrable initially deferred` for exactly this write -- see that file.
 *
 * Diff, not replace -- the same medicine syncCells got, for a sharper version of
 * the same reason. `zones.stage_id references project_stages on delete cascade`
 * (0003) and `cells.stage_id ... on delete set null` (0001), so deleting the
 * stage rows and re-inserting them destroyed EVERY zone and every zone_cells
 * link in the project, plus every tick of recorded progress -- on a rename, on a
 * weight tweak, on any save at all.
 *
 * Only an id that genuinely disappears from the draft is deleted, and that
 * delete does cascade its zones away and null the cells sitting at that stage.
 * That is correct -- a zone is a plan for one specific stage and is meaningless
 * without it -- and it is what the caller's confirmation dialog has to describe.
 * Use `stagesRemovedBy` to find out whether there is anything to describe.
 *
 * The Σ = 1 rule is enforced here rather than in the database: it spans rows, so
 * a CHECK constraint cannot express it and a deferred trigger would fire in the
 * middle of a multi-row edit. Validating before any write also means a rejected
 * save leaves the existing stages untouched.
 *
 * THE DELETE GOES FIRST, and the order is not a preference. The panel renumbers
 * the survivors 1..n, so removing anything but the last stage moves a survivor
 * INTO a seq the row being removed still holds. Upserting first therefore put
 * two rows at one seq and Postgres rejected the whole statement with `duplicate
 * key value violates unique constraint "project_stages_project_id_seq_key"`:
 * nothing was deleted, nothing was renamed, and only the last stage in the list
 * could ever be removed. 0012's deferral does not save it either -- deferring
 * moves the check to COMMIT, and the upsert is its own PostgREST round trip, so
 * it commits on its own with the collision still in place.
 *
 * Deleting first cannot collide: it only ever frees seqs. Do not reorder these
 * two statements back.
 *
 * Not transactional: the delete and the upsert are separate round trips, so a
 * failure between them leaves the removal applied and the renumbering not. That
 * is the safe half to lose. `computeDeckProgress` compares
 * `stageSeqOf(...) >= stage.seq` over a sorted copy, so it depends on relative
 * order only -- a GAP in seq changes no percentage at all. What is left behind
 * is a gap plus Σ weight ≠ 1, which the admin resolves by re-editing the weights
 * the panel is already refusing to save. Closing the window entirely needs an
 * RPC.
 */
export async function saveStages(projectId: string, stages: Stage[]): Promise<void> {
  if (stages.length === 0) {
    throw new Error('A project needs at least one stage')
  }
  const seqs = new Set(stages.map((s) => s.seq))
  if (seqs.size !== stages.length) {
    throw new Error('Stage seq values must be unique')
  }
  // Two draft rows claiming one id would make the upsert's `do update` touch the
  // same row twice, which Postgres rejects with "ON CONFLICT DO UPDATE command
  // cannot affect row a second time" -- and it would mean two stages sharing one
  // set of recorded cells. Caught here so the message says what is wrong.
  const ids = new Set(stages.map((s) => s.id))
  if (ids.size !== stages.length) {
    throw new Error('Stage ids must be unique')
  }
  const total = stages.reduce((sum, s) => sum + s.weight, 0)
  if (Math.abs(total - 1) > STAGE_WEIGHT_EPSILON) {
    throw new Error(`Stage weights must sum to 1, got ${total.toFixed(4)}`)
  }

  // Snapshot first: the draft says which stages should exist, never which ones
  // were removed, so the only way to name them is to diff against what is
  // persisted right now.
  const removed = stagesRemovedBy(await listStages(projectId), stages)

  // Removals first, so the survivors' renumbered seqs land on seqs nobody holds
  // any more -- see the write-order paragraph above. By explicit id, and only
  // when there is something to delete. A `.eq('project_id', projectId)` delete
  // here would be exactly the bug this rewrite exists to remove, and it would
  // satisfy any assertion that a delete was issued.
  if (removed.length > 0) {
    const { error: deleteError } = await supabase
      .from('project_stages')
      .delete()
      .in('id', removed.map((r) => r.id))
    if (deleteError) throw new Error(deleteError.message)
  }

  const { error: upsertError } = await supabase.from('project_stages').upsert(
    stages.map((s) => ({
      id: s.id,
      project_id: projectId,
      seq: s.seq,
      name: s.name,
      color: s.color,
      weight: s.weight,
    })),
    { onConflict: 'id' },
  )
  if (upsertError) throw new Error(upsertError.message)
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
      // Redundant today: computeProjectProgress sorts its stages internally,
      // so this call has no observable effect on `progress` below and a
      // mutation deleting it survives. Left in and commented, not removed --
      // `stages` is local to this map body and unused for anything else, but
      // the next reader should not have to re-derive that from scratch to
      // know it is safe to leave alone (or unsafe to rely on elsewhere).
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
