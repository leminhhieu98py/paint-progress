import dayjs from 'dayjs'
import type { Zone } from './types'

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
 * A short marker per zone -- `Z1`, `Z2` -- and the cell labels that carry it.
 *
 * A date range is thirteen characters. On a deck of two-hundred bays most are
 * too narrow to hold that at a legible size, so `fitLabelFontSize` correctly
 * refuses to draw it and the drawing goes silent about a plan that exists. The
 * admin's screenshot showed the failure the other way round: at a fixed size the
 * range spilled over three neighbouring bays and said its piece about the wrong
 * one.
 *
 * Two or three characters fit almost anywhere. The drawing answers "which group
 * is this bay in"; the zone table beside it answers "and when is that group
 * scheduled". Neither has to shrink to fit the other.
 *
 * Numbered by position in the list, which is `listDeckZones`' seq order, so the
 * marker on a bay and the row in the table always agree.
 */
export function zoneMarkers(zones: Zone[]): Record<string, string> {
  return Object.fromEntries(zones.map((z, i) => [z.id, `Z${i + 1}`]))
}

/**
 * Cell code -> zone marker, for the admin's canvas.
 *
 * Deliberately separate from `buildPlanLabels`, which still emits the full range
 * for the GS screen: a foreman has no zone table to look the marker up in, so a
 * bare `Z3` on a tablet would say less than nothing.
 *
 * Later zones win a shared cell, matching buildPlanLabels: a higher seq is the
 * more recent plan for that bay.
 */
export function buildZoneMarkerLabels(
  zones: Zone[],
  cells: { id: string; code: string }[],
): Record<string, string> {
  const markers = zoneMarkers(zones)
  const codeById = new Map(cells.map((c) => [c.id, c.code]))
  const labels: Record<string, string> = {}
  for (const zone of zones) {
    for (const cellId of zone.cellIds) {
      const code = codeById.get(cellId)
      if (code) labels[code] = markers[zone.id]
    }
  }
  return labels
}
