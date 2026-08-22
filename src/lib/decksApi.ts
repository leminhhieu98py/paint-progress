import type { Guide, MeshCell } from '../domain/types'
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
    .select('id, project_id, seq, name, code, image_path, image_w, image_h, total_area_m2, area_source, cells(id)')
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
    totalAreaM2: Number(d.total_area_m2),
    areaSource: d.area_source as 'guides' | 'prorated',
    cellCount: ((d.cells ?? []) as unknown[]).length,
  }))
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
  return (data as { id: string }).id
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
): Promise<string> {
  const path = `${projectId}/${deckId}.png`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, { upsert: true, contentType: 'image/png' })
  if (uploadError) throw new Error(uploadError.message)

  const { error } = await supabase
    .from('decks')
    .update({ image_path: path, image_w: width, image_h: height })
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

export async function listGuides(deckId: string): Promise<Guide[]> {
  const { data, error } = await supabase
    .from('deck_guides')
    .select('id, axis, pos, offset_mm')
    .eq('deck_id', deckId)
    // Both current consumers re-sort this themselves (DeckEditor's axisRows,
    // buildMeshFromGuides), so nothing depends on this order today -- but it
    // is a real guarantee this endpoint should make rather than an unstated
    // accident, and DeckEditor's mm-chain math (spansFromOffsets) is exactly
    // the kind of caller that would silently misbehave without one.
    .order('offset_mm')
  if (error) throw new Error(error.message)
  return (data ?? []).map((g) => ({
    id: g.id as string,
    axis: g.axis as 'x' | 'y',
    pos: Number(g.pos),
    offsetMm: Number(g.offset_mm),
  }))
}

/**
 * Make the deck's persisted guides match `guides`, keyed by id.
 *
 * Diff, not replace, and this is the third write path to get that treatment
 * after syncCells and saveStages. It used to delete every guide for the deck
 * and then insert the new set, which was survivable while saving guides was its
 * own button -- but one save action now writes guides, area and cells together,
 * so it fires on every delete and every merge too. Deleting a single cell
 * destroyed the deck's entire mm chain and rebuilt it; if the insert failed on a
 * site tether, the guides were gone from the database while the editor still
 * showed them. Retrying from the same screen recovered; closing the editor lost
 * the chain permanently, and with it every cell area on the deck.
 *
 * Do NOT "recover" from a failure here by reloading guides. Local state is the
 * only surviving copy of the chain at that point, so a reload would destroy the
 * very thing that makes a retry possible -- see the comment in DeckEditor's
 * `apply`, which deliberately re-reads cells and not guides.
 *
 * `deck_guides.id` is a uuid primary key, so identity is available and this is
 * an upsert on it plus a delete of the ids that disappeared. Every guide passed
 * in must already carry an id: `listGuides` supplies the database's own, and
 * DeckEditor mints one with `randomUUID` the moment the admin adds a guide.
 *
 * THE UPSERT GOES FIRST here, the opposite of saveStages, and the difference is
 * not an inconsistency. saveStages has no choice: `unique (project_id, seq)`
 * means a renumbered survivor collides with a row still holding its seq, so the
 * delete has to free the seq first. deck_guides has no such constraint, which
 * leaves the order free to be chosen on the failure mode -- and here the whole
 * point is that a failed write must not be able to lose an existing guide. If
 * the upsert fails nothing has been deleted yet and the chain is intact; if the
 * delete then fails, the deck keeps a stale guide, which is visible on the next
 * generated mesh and fixable from the screen.
 *
 * Not transactional either way: closing that needs an RPC.
 */
export async function saveGuides(deckId: string, guides: Guide[]): Promise<void> {
  // Snapshot first, for the same reason saveStages does: the incoming list says
  // which guides should exist, never which ones were removed.
  const before = await listGuides(deckId)
  const nextIds = new Set(guides.map((g) => g.id))
  const removed = before.filter((b) => !nextIds.has(b.id))

  if (guides.length > 0) {
    const { error } = await supabase.from('deck_guides').upsert(
      guides.map((g) => ({
        id: g.id,
        deck_id: deckId,
        axis: g.axis,
        pos: g.pos,
        offset_mm: g.offsetMm,
      })),
      { onConflict: 'id' },
    )
    if (error) throw new Error(error.message)
  }

  // By explicit id, and only when there is something to delete. A
  // `.eq('deck_id', deckId)` delete here is exactly the write this rewrite
  // exists to remove.
  if (removed.length > 0) {
    const { error } = await supabase
      .from('deck_guides')
      .delete()
      .in('id', removed.map((r) => r.id))
    if (error) throw new Error(error.message)
  }
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
