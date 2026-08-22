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

export type PersistedCell = MeshCell & { id: string; stageId: string | null }

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
  if (error) throw new Error(error.message)
  return (data ?? []).map((g) => ({
    id: g.id as string,
    axis: g.axis as 'x' | 'y',
    pos: Number(g.pos),
    offsetMm: Number(g.offset_mm),
  }))
}

export async function saveGuides(
  deckId: string,
  guides: Omit<Guide, 'id'>[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('deck_guides')
    .delete()
    .eq('deck_id', deckId)
  if (deleteError) throw new Error(deleteError.message)

  if (guides.length === 0) return

  const { error } = await supabase.from('deck_guides').insert(
    guides.map((g) => ({
      deck_id: deckId,
      axis: g.axis,
      pos: g.pos,
      offset_mm: g.offsetMm,
    })),
  )
  if (error) throw new Error(error.message)
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
 * Replaces a deck's entire cell set, carrying stage progress and zone
 * membership across by cell code.
 *
 * Delete before insert, always. `cells` has unique(deck_id, code) and a merge
 * keeps the top-left source's code, so inserting first collides with the very
 * row being replaced.
 *
 * The carry-across is not a nicety, it is the difference between this function
 * being usable and being a footgun. Deleting a cell cascades `zone_cells` and
 * discards `stage_id`, so a naive delete-and-reinsert would wipe every zone on
 * the deck and every tick of recorded progress — even for cells the edit never
 * touched. Code is the stable identity across a regeneration, so both are
 * re-attached by code.
 *
 * `zoneLinks` lets a merge satisfy spec §8.3's requirement that the merged cell
 * inherits every zone its sources belonged to: pass
 * `{ [mergedCode]: [...sourceCodes] }` and the union of those zones is applied
 * to the survivor.
 *
 * The carry-across covers zone membership and the surviving cell's own progress.
 * It does NOT rescue progress recorded on a merge source that is not the
 * survivor: that stage_id is discarded. There is no honest rule that would --
 * taking the furthest-along stage over-reports the merged bay, taking the least
 * under-reports it, and both distort a percentage that must match the
 * spreadsheet in circulation. Merging bays with divergent recorded progress is a
 * data-modelling mistake, so Task 8's editor warns before allowing it rather
 * than this function guessing.
 */
export async function replaceCells(
  deckId: string,
  cells: MeshCell[],
  zoneLinks: Record<string, string[]> = {},
): Promise<void> {
  // Snapshot what must survive, keyed by the code that identifies it.
  const before = await listCells(deckId)
  const stageByCode = new Map(before.filter((c) => c.stageId).map((c) => [c.code, c.stageId!]))

  const { data: linkRows, error: linkError } = await supabase
    .from('zone_cells')
    .select('zone_id, cells!inner(code, deck_id)')
    .eq('cells.deck_id', deckId)
  if (linkError) throw new Error(linkError.message)

  const zonesByCode = new Map<string, Set<string>>()
  for (const row of (linkRows ?? []) as Record<string, unknown>[]) {
    const code = (row.cells as { code: string } | null)?.code
    if (!code) continue
    const set = zonesByCode.get(code) ?? new Set<string>()
    set.add(row.zone_id as string)
    zonesByCode.set(code, set)
  }

  const { error: deleteError } = await supabase.from('cells').delete().eq('deck_id', deckId)
  if (deleteError) throw new Error(deleteError.message)

  if (cells.length === 0) return

  const { data: inserted, error } = await supabase
    .from('cells')
    .insert(
      cells.map((c) => ({
        deck_id: deckId,
        code: c.code,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        area_m2: c.areaM2,
        stage_id: stageByCode.get(c.code) ?? null,
      })),
    )
    .select('id, code')
  if (error) throw new Error(error.message)

  // Re-attach zone membership. A merged code inherits the union of the zones its
  // sources held, so a zone that planned any source still plans the survivor.
  const idByCode = new Map(
    ((inserted ?? []) as Record<string, unknown>[]).map((r) => [r.code as string, r.id as string]),
  )
  const links: { zone_id: string; cell_id: string }[] = []
  for (const [code, cellId] of idByCode) {
    const sources = zoneLinks[code] ?? [code]
    const zoneIds = new Set<string>()
    for (const source of sources) {
      for (const zoneId of zonesByCode.get(source) ?? []) zoneIds.add(zoneId)
    }
    for (const zoneId of zoneIds) links.push({ zone_id: zoneId, cell_id: cellId })
  }
  if (links.length === 0) return

  const { error: relinkError } = await supabase.from('zone_cells').insert(links)
  if (relinkError) throw new Error(relinkError.message)
}
