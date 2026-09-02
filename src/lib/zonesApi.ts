import type { Zone } from '../domain/types'
import { supabase } from './supabase'

/**
 * Zones: the `Kế hoạch tháo GG` sheet, and the dated annotations the admin used
 * to draw on the PDFs by hand.
 *
 * Both roles read these rows -- the admin's zone table and the foreman's plan
 * labels -- so there is ONE reader here, not one per role. `listDeckZones` used
 * to live in `gsApi` alongside it, which made every admin screen that shows a
 * plan import the foreman's module to get it.
 *
 * Zones live in the database, so a GS toggling "Hiện kế hoạch" sees a zone the
 * moment it exists. There is no synchronisation step anywhere, and that is the
 * whole of spec §8.5's "sync back to the drawings".
 */

export interface ZoneDraft {
  name: string
  stageId: string
  startDate: string | null
  finishDate: string | null
}

/**
 * A named group of cells, planned for one stage over one date range.
 *
 * The seq is read rather than counted client-side because `unique (deck_id,
 * stage_id, seq)` (0001) counts PER STAGE: a deck with four zones on Coat 3 and
 * none on Tháo giáo starts the first Tháo giáo zone at 1, not 5.
 *
 * Not transactional -- the zone and its members are two round trips -- so a
 * failure between them rolls the zone back. A zone with no cells is exactly what
 * the guard below refuses to create: it takes a row, labels nothing on the
 * drawing, and `setZoneActual` over it writes to nothing while reporting
 * success.
 */
export async function createZone(
  deckId: string,
  draft: ZoneDraft,
  cellIds: string[],
): Promise<string> {
  if (cellIds.length === 0) {
    throw new Error('A zone needs at least one cell')
  }

  const { data: seqRows, error: seqError } = await supabase
    .from('zones')
    .select('seq')
    .eq('deck_id', deckId)
    .eq('stage_id', draft.stageId)
    .order('seq', { ascending: false })
    .limit(1)
  if (seqError) throw new Error(seqError.message)
  const seq = ((seqRows?.[0]?.seq as number | undefined) ?? 0) + 1

  const { data, error } = await supabase
    .from('zones')
    .insert({
      deck_id: deckId,
      seq,
      name: draft.name,
      stage_id: draft.stageId,
      start_date: draft.startDate,
      finish_date: draft.finishDate,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const zoneId = (data as { id: string }).id

  const { error: linkError } = await supabase
    .from('zone_cells')
    .insert(cellIds.map((cellId) => ({ zone_id: zoneId, cell_id: cellId })))
  if (linkError) {
    await supabase.from('zones').delete().eq('id', zoneId)
    throw new Error(linkError.message)
  }

  return zoneId
}

/**
 * A patch, not a replace.
 *
 * The dates are edited inline in the zone table, one field at a time. Sending
 * the whole row on every keystroke would let a stale name overwrite a rename
 * made in another tab -- and the admin and the foreman are both looking at this
 * plan.
 *
 * `null` is a value, not "leave alone": clearing a finish date is how a zone
 * whose end has slipped is expressed, so the fields are picked by key presence
 * rather than by truthiness.
 */
export async function updateZone(
  zoneId: string,
  fields: Partial<{ name: string; startDate: string | null; finishDate: string | null }>,
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('name' in fields) patch.name = fields.name
  if ('startDate' in fields) patch.start_date = fields.startDate
  if ('finishDate' in fields) patch.finish_date = fields.finishDate
  if (Object.keys(patch).length === 0) return

  const { error } = await supabase.from('zones').update(patch).eq('id', zoneId)
  if (error) throw new Error(error.message)
}

/** `zone_cells.zone_id` is ON DELETE CASCADE (0003), so the memberships go with
 *  it. The cells themselves are untouched -- a plan is deleted, not the work. */
export async function deleteZone(zoneId: string): Promise<void> {
  const { error } = await supabase.from('zones').delete().eq('id', zoneId)
  if (error) throw new Error(error.message)
}

/**
 * "Set actual": record one stage across every cell the zone covers, and return
 * how many bays were actually written.
 *
 * The count is returned rather than assumed. PostgREST answers an UPDATE
 * matching zero rows with 204 and no error, so without reading the affected rows
 * back this cannot tell "stamped forty bays" from "stamped none" -- and the
 * admin would be told the plan was applied either way.
 *
 * Scoped `.in('id', ...)` on the zone's own cells. A `.eq('deck_id', ...)` write
 * would stamp every bay on the deck from a button labelled with one zone's name,
 * and would look entirely successful.
 *
 * Each write still passes `assert_stage_belongs_to_project` (0018), so a stage
 * from another deck is refused by the database rather than trusted from here.
 */
export async function setZoneActual(zoneId: string, stageId: string): Promise<number> {
  // The stage names its (work, deck), so the caller passes nothing else -- and
  // a stage row that is gone is refused before any bay is touched.
  const { data: stages, error: stageError } = await supabase
    .from('deck_stages')
    .select('id, work_id, deck_id')
    .eq('id', stageId)
  if (stageError) throw new Error(stageError.message)
  const stage = ((stages ?? []) as { id: string; work_id: string; deck_id: string }[])[0]
  if (!stage) throw new Error(`Stage ${stageId} was not found`)

  const { data: members, error: readError } = await supabase
    .from('zone_cells')
    .select('cell_id')
    .eq('zone_id', zoneId)
  if (readError) throw new Error(readError.message)

  const cellIds = (members ?? []).map((m) => (m as { cell_id: string }).cell_id)
  if (cellIds.length === 0) return 0

  // Since 0024 a bay's position is its cell_states row per work: an upsert on
  // (cell, work), never a deck-wide write -- a deck-scoped statement would
  // stamp every bay on the deck from a button labelled with one zone's name.
  const { data, error } = await supabase
    .from('cell_states')
    .upsert(
      cellIds.map((cellId) => ({
        cell_id: cellId, work_id: stage.work_id, deck_id: stage.deck_id, stage_id: stageId,
      })),
      { onConflict: 'cell_id,work_id' },
    )
    .select('cell_id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

/**
 * A deck's planned zones, with their member cell ids.
 *
 * Ordered by seq, which buildPlanLabels relies on to resolve a cell claimed by
 * two zones. One embedded select rather than two queries: zone_cells has no
 * columns of its own worth returning, and a second round trip on a site tether
 * to attach ids is a round trip for nothing.
 * */
export async function listDeckZones(deckId: string): Promise<Zone[]> {
  const { data, error } = await supabase
    .from('zones')
    .select('id, name, stage_id, start_date, finish_date, zone_cells(cell_id)')
    .eq('deck_id', deckId)
    .order('seq')
  if (error) throw new Error(error.message)

  return (data ?? []).map((z) => ({
    id: z.id as string,
    name: z.name as string,
    stageId: z.stage_id as string,
    startDate: (z.start_date as string | null) ?? null,
    finishDate: (z.finish_date as string | null) ?? null,
    cellIds: ((z.zone_cells ?? []) as { cell_id: string }[]).map((zc) => zc.cell_id),
  }))
}
