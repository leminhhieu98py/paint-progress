import type { MeshCell, Stage } from '../domain/types'
import { supabase } from './supabase'

export interface DeckRow {
  id: string
  projectId: string
  seq: number
  name: string
  code: string
  imagePath: string | null
  imageW: number | null
  imageH: number | null
  /** What the uploaded file was called, and which page. Null on decks whose drawing predates recording it. */
  drawingName: string | null
  drawingPage: number | null
  totalAreaM2: number
  areaSource: 'guides' | 'prorated'
  cellCount: number
}

type PersistedCell = MeshCell & { id: string; stageId: string | null }

export interface ZoneImpact {
  zoneId: string
  zoneName: string
  cellCodes: string[]
}

const BUCKET = 'drawings'

export async function listDecks(projectId: string): Promise<DeckRow[]> {
  const { data, error } = await supabase
    .from('decks')
    .select('id, project_id, seq, name, code, image_path, image_w, image_h, drawing_name, drawing_page, total_area_m2, area_source, cells(id)')
    .eq('project_id', projectId)
    .order('seq')
  if (error) throw new Error(error.message)
  return (data ?? []).map((d) => ({
    id: d.id as string,
    projectId: d.project_id as string,
    seq: d.seq as number,
    name: d.name as string,
    code: d.code as string,
    imagePath: (d.image_path as string | null) ?? null,
    imageW: (d.image_w as number | null) ?? null,
    imageH: (d.image_h as number | null) ?? null,
    drawingName: (d.drawing_name as string | null) ?? null,
    drawingPage: (d.drawing_page as number | null) ?? null,
    totalAreaM2: Number(d.total_area_m2),
    areaSource: d.area_source as 'guides' | 'prorated',
    cellCount: ((d.cells ?? []) as unknown[]).length,
  }))
}

/**
 * One deck, by the id in the URL.
 *
 * The deck screen is addressable now -- a reload, a bookmark or a link opens
 * the same deck -- and none of those carry the project it belongs to, which is
 * all `listDecks` can be asked by. `maybeSingle` so an id that no longer names
 * a deck comes back as null for the screen to report, rather than as an error
 * indistinguishable from the network being down.
 */
export async function getDeck(deckId: string): Promise<DeckRow | null> {
  const { data, error } = await supabase
    .from('decks')
    .select('id, project_id, seq, name, code, image_path, image_w, image_h, drawing_name, drawing_page, total_area_m2, area_source, cells(id)')
    .eq('id', deckId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    id: data.id as string,
    projectId: data.project_id as string,
    seq: data.seq as number,
    name: data.name as string,
    code: data.code as string,
    imagePath: (data.image_path as string | null) ?? null,
    imageW: (data.image_w as number | null) ?? null,
    imageH: (data.image_h as number | null) ?? null,
    drawingName: (data.drawing_name as string | null) ?? null,
    drawingPage: (data.drawing_page as number | null) ?? null,
    totalAreaM2: Number(data.total_area_m2),
    areaSource: data.area_source as 'guides' | 'prorated',
    cellCount: ((data.cells ?? []) as unknown[]).length,
  }
}

/** Renames a deck and re-codes it, without touching its geometry. */
export async function updateDeckIdentity(
  deckId: string, name: string, code: string,
): Promise<void> {
  const { error } = await supabase.from('decks').update({ name, code }).eq('id', deckId)
  if (error) throw new Error(error.message)
}

export async function createDeck(input: {
  projectId: string
  seq: number
  name: string
  code: string
}): Promise<string> {
  const { data, error } = await supabase
    .from('decks')
    .insert({
      project_id: input.projectId,
      seq: input.seq,
      name: input.name,
      code: input.code,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const deckId = (data as { id: string }).id

  /*
    Deliberately NOT seeded with a stage template.

    It used to be, on the reasoning that a deck with no stages reports 0% for
    ever and nothing raises the alarm. In practice the seed was the louder
    failure: every deck arrived carrying five coats named after one project's
    paint spec, at that project's weights, and a deck whose real spec is three
    coats had to have two deleted -- a destructive edit, on a list the admin
    never asked for, before they had declared anything.

    The empty list is now visible and blocked instead of silent: A3.2 says the
    deck has no coats yet, and its save refuses an empty list outright, so a
    deck cannot reach the foreman's tablet without a spec someone declared.
  */
  return deckId
}

export async function updateDeckArea(
  deckId: string,
  totalAreaM2: number,
  areaSource: 'guides' | 'prorated',
): Promise<void> {
  const { error } = await supabase
    .from('decks')
    .update({ total_area_m2: totalAreaM2, area_source: areaSource })
    .eq('id', deckId)
  if (error) throw new Error(error.message)
}

/**
 * Uploads the rendered drawing and records its pixel dimensions on the deck.
 *
 * The path is {projectId}/{deckId}.png because the storage policy derives the
 * project from the first folder segment — see migration 0009. Storage is written
 * first: if it fails there is nothing to undo, whereas recording dimensions for
 * an image that does not exist would leave the editor pointing at nothing.
 */
export async function uploadDrawing(
  deckId: string,
  projectId: string,
  png: Blob,
  width: number,
  height: number,
  /**
   * What the file was called, and which page was taken.
   *
   * The stored image is a render named from ids, so without this an admin who
   * uploaded a drawing and came back later had nothing to recognise it by --
   * on a project whose sheets are all called things like 00171-14.
   */
  origin?: { name: string; page: number | null },
): Promise<string> {
  const path = `${projectId}/${deckId}.png`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, { upsert: true, contentType: 'image/png' })
  if (uploadError) throw new Error(uploadError.message)

  const { error } = await supabase
    .from('decks')
    .update({
      image_path: path,
      image_w: width,
      image_h: height,
      drawing_name: origin?.name ?? null,
      drawing_page: origin?.page ?? null,
    })
    .eq('id', deckId)
  if (error) throw new Error(error.message)

  return path
}

/** Signed URL: the bucket is private, so the browser cannot fetch it directly. */
export async function getDrawingUrl(imagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(imagePath, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export async function listCells(deckId: string): Promise<PersistedCell[]> {
  const { data, error } = await supabase
    .from('cells')
    .select('id, code, x, y, w, h, area_m2, stage_id')
    .eq('deck_id', deckId)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? []).map((c) => ({
    id: c.id as string,
    code: c.code as string,
    x: Number(c.x),
    y: Number(c.y),
    w: Number(c.w),
    h: Number(c.h),
    areaM2: Number(c.area_m2),
    stageId: (c.stage_id as string | null) ?? null,
  }))
}

/**
 * Which zones would lose members if these cells were deleted or merged away.
 *
 * zone_cells cascades on cell_id, so a destructive geometry edit silently
 * shrinks a zone. Spec §8.3 requires naming the affected zones before applying
 * the edit, which is what this feeds.
 */
export async function zoneImpactOf(deckId: string, cellIds: string[]): Promise<ZoneImpact[]> {
  if (cellIds.length === 0) return []

  const { data, error } = await supabase
    .from('zone_cells')
    // deckId is a safety scope, not redundancy: cell ids are globally unique, so
    // this query would happily return another deck's zones if a caller passed a
    // stale selection (DeckEditor is remounted per deck, so a selection carried
    // over from a previous deck is plausible). Those names would then appear in
    // a destructive-edit warning for the wrong deck, which is worse than no
    // warning at all.
    .select('cell_id, cells!inner(code, deck_id), zones(id, name)')
    .in('cell_id', cellIds)
    .eq('cells.deck_id', deckId)
  if (error) throw new Error(error.message)

  const byZone = new Map<string, ZoneImpact>()
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const zone = row.zones as { id: string; name: string } | null
    const cell = row.cells as { code: string } | null
    if (!zone || !cell) continue
    const existing = byZone.get(zone.id)
    if (existing) existing.cellCodes.push(cell.code)
    else byZone.set(zone.id, { zoneId: zone.id, zoneName: zone.name, cellCodes: [cell.code] })
  }
  return [...byZone.values()]
}

/**
 * Make the deck's persisted cells match `cells`, keyed by code.
 *
 * Diff, not replace. An untouched cell keeps its id, and with it the stage GS
 * recorded, its zone membership, and its cell_events history — cell_events
 * cascades on cell_id, so deleting and re-inserting a cell destroys its audit
 * trail. The upsert payload deliberately carries no stage_id: authoring
 * geometry must never overwrite recorded progress.
 *
 * `inheritFrom` maps a surviving code to the codes it absorbed, so a merge
 * survivor picks up the zones its sources belonged to (spec 8.3). Its own
 * links need no work — its row was updated, not replaced.
 */
export async function syncCells(
  deckId: string,
  cells: MeshCell[],
  inheritFrom: Record<string, string[]> = {},
): Promise<void> {
  const before = await listCells(deckId)
  const nextCodes = new Set(cells.map((c) => c.code))
  const removed = before.filter((b) => !nextCodes.has(b.code))

  // Snapshot the zones held by the codes a survivor absorbs, BEFORE the delete:
  // zone_cells cascades on cell_id, so afterwards those rows no longer exist.
  // Only worth a round trip when a survivor actually absorbs a vanishing code.
  const absorbed = new Set(Object.values(inheritFrom).flat())
  const zonesByCode = new Map<string, Set<string>>()
  if (removed.some((r) => absorbed.has(r.code))) {
    const { data, error } = await supabase
      .from('zone_cells')
      .select('zone_id, cell_id')
      .in('cell_id', removed.map((r) => r.id))
    if (error) throw new Error(error.message)

    const codeById = new Map(before.map((b) => [b.id, b.code]))
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const code = codeById.get(row.cell_id as string)
      if (!code) continue
      const set = zonesByCode.get(code) ?? new Set<string>()
      set.add(row.zone_id as string)
      zonesByCode.set(code, set)
    }
  }

  // Geometry only. PostgREST builds the `do update set` from the payload keys,
  // so omitting stage_id leaves an existing cell's stage untouched and a new
  // cell's null -- which is exactly the guarantee this function is for.
  const idByCode = new Map<string, string>()
  if (cells.length > 0) {
    const { data: upserted, error } = await supabase
      .from('cells')
      .upsert(
        cells.map((c) => ({
          deck_id: deckId,
          code: c.code,
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          area_m2: c.areaM2,
        })),
        { onConflict: 'deck_id,code' },
      )
      .select('id, code')
    if (error) throw new Error(error.message)
    for (const row of (upserted ?? []) as Record<string, unknown>[]) {
      idByCode.set(row.code as string, row.id as string)
    }
  }

  // By explicit id, and only when there is something to delete: `.in('id', [])`
  // is a pointless round trip, and a deck-wide delete here would be the bug
  // this whole function exists to avoid.
  if (removed.length > 0) {
    const { error } = await supabase
      .from('cells')
      .delete()
      .in('id', removed.map((r) => r.id))
    if (error) throw new Error(error.message)
  }

  // Re-link the survivor into every zone its sources held. Upserted against the
  // zone_cells primary key with ignoreDuplicates: a source may share a zone
  // with the survivor, and that is a no-op, not a conflict.
  const links: { zone_id: string; cell_id: string }[] = []
  for (const [survivorCode, sourceCodes] of Object.entries(inheritFrom)) {
    const cellId = idByCode.get(survivorCode)
    if (!cellId) continue
    const zoneIds = new Set<string>()
    for (const source of sourceCodes) {
      for (const zoneId of zonesByCode.get(source) ?? []) zoneIds.add(zoneId)
    }
    for (const zoneId of zoneIds) links.push({ zone_id: zoneId, cell_id: cellId })
  }
  if (links.length === 0) return

  const { error: relinkError } = await supabase
    .from('zone_cells')
    .upsert(links, { onConflict: 'zone_id,cell_id', ignoreDuplicates: true })
  if (relinkError) throw new Error(relinkError.message)
}

// ---------------------------------------------------------------------------
// Paint stages.
//
// These live here, not in projectsApi, because 0018 moved a stage onto the DECK:
// a main deck, a cellar deck and a helideck on one job carry different coat
// systems. They were written when a stage belonged to a project and moved
// wholesale when the scope changed -- the bodies are unchanged, so their history
// reads against `git log --follow` on the old file.
// ---------------------------------------------------------------------------

/**
 * Weights are entered as decimals in a form, so an exact === 1 test would
 * reject 0.1+0.1+0.1+0.7. Compare within this instead.
 *
 * Sized to `deck_stages.weight`, which is `numeric(6,5)` -- scale 5. A
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
 * Rounds a weight to what `deck_stages.weight` can actually hold.
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

export async function listStages(deckId: string): Promise<Stage[]> {
  const { data, error } = await supabase
    .from('deck_stages')
    .select('id, seq, name, color, weight')
    .eq('deck_id', deckId)
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
 * it `deferrable initially deferred` for exactly this write -- see that file;
 * 0018 carried the deferral onto `unique (deck_id, seq)`.
 *
 * Diff, not replace -- the same medicine syncCells got, for a sharper version of
 * the same reason. `zones.stage_id references deck_stages on delete cascade`
 * (0003) and `cells.stage_id ... on delete set null` (0001), so deleting the
 * stage rows and re-inserting them destroyed EVERY zone and every zone_cells
 * link on the deck, plus every tick of recorded progress -- on a rename, on a
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
 * key value violates unique constraint "deck_stages_deck_id_seq_key"`:
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
export async function saveStages(deckId: string, stages: Stage[]): Promise<void> {
  if (stages.length === 0) {
    throw new Error('A deck needs at least one stage')
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
  const removed = stagesRemovedBy(await listStages(deckId), stages)

  // Removals first, so the survivors' renumbered seqs land on seqs nobody holds
  // any more -- see the write-order paragraph above. By explicit id, and only
  // when there is something to delete. A `.eq('deck_id', deckId)` delete
  // here would be exactly the bug this rewrite exists to remove, and it would
  // satisfy any assertion that a delete was issued.
  if (removed.length > 0) {
    const { error: deleteError } = await supabase
      .from('deck_stages')
      .delete()
      .in('id', removed.map((r) => r.id))
    if (deleteError) throw new Error(deleteError.message)
  }

  const { error: upsertError } = await supabase.from('deck_stages').upsert(
    stages.map((s) => ({
      id: s.id,
      deck_id: deckId,
      seq: s.seq,
      name: s.name,
      color: s.color,
      weight: s.weight,
    })),
    { onConflict: 'id' },
  )
  if (upsertError) throw new Error(upsertError.message)
}
