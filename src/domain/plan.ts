import dayjs from 'dayjs'
import type { Stage, Zone } from './types'

/**
 * A zone's planned dates in the form the source drawings use: `13/08 – 19/08`,
 * or a single `15/07` when only one end is known.
 *
 * dayjs parses a date-only string as local midnight, so `format('DD/MM')` reads
 * back the same calendar day it was given. Do not "improve" this by going
 * through `new Date(...).toISOString()`: that parses the string as UTC and then
 * renders it locally, printing every planned start one day early west of
 * Greenwich.
 */
export function formatPlanRange(startDate: string | null, finishDate: string | null): string {
  const start = startDate ? dayjs(startDate).format('DD/MM') : null
  const finish = finishDate ? dayjs(finishDate).format('DD/MM') : null
  if (start && finish) return `${start} – ${finish}`
  return start ?? finish ?? ''
}

/**
 * The label to draw on each cell that belongs to a zone, keyed by cell CODE.
 *
 * Code, because that is what DrawingCanvas keys every per-cell map on, while a
 * zone knows only cell ids. A cell id with no matching cell on this deck is
 * skipped rather than labelled: zone_cells cascades on cell_id so it should not
 * arise, but a zone list held across a deck switch would otherwise annotate this
 * drawing with another deck's plan.
 *
 * A zone with no dates falls back to its own name. An empty label would draw a
 * dashed outline with nothing to explain it.
 *
 * Zones arrive in seq order and later ones overwrite earlier ones on a shared
 * cell: the higher seq is the more recent plan for that bay.
 */
export function buildPlanLabels(
  zones: Zone[],
  cells: { id: string; code: string }[],
): Record<string, string> {
  const codeById = new Map(cells.map((c) => [c.id, c.code]))
  const labels: Record<string, string> = {}
  for (const zone of zones) {
    const range = formatPlanRange(zone.startDate, zone.finishDate)
    const label = range === '' ? zone.name : range
    for (const cellId of zone.cellIds) {
      const code = codeById.get(cellId)
      if (code) labels[code] = label
    }
  }
  return labels
}

/**
 * The stage whose colour a zone would borrow, or null (Feedback Rv2, item 6).
 *
 * Linh's rule is exactly "not one of the A3.2 colours": a zone painted in
 * Coat 2's colour reads as Coat 2 on the drawing. Exact hex, case-insensitive
 * -- two similar colours are allowed, because "similar" is a judgement the
 * picker's presets already make for the admin.
 */
export function zoneColorConflict(color: string, stages: Stage[]): Stage | null {
  const wanted = color.toLowerCase()
  return stages.find((s) => s.color.toLowerCase() === wanted) ?? null
}
