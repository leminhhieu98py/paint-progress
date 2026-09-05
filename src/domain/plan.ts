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
 * One zone named on the drawing itself (Feedback Rv3, item 4): the zone's name
 * and its planned dates, over the box its bays occupy.
 *
 * This replaces the per-cell labelling this module used to do (`buildPlanLabels`,
 * removed with the canvas prop it fed). Repeating a date range on every bay of a
 * zone printed the same eight characters forty times and still left the reader
 * to work out where one zone ended and the next began; Linh asked for the zone
 * NAMED, once, where it is -- the way the source drawings annotate them.
 *
 * The box is the bounding box of the zone's bays in the drawing's own
 * normalised coordinates, so the canvas can place the label without knowing
 * anything about zones. A zone whose bays all belong to another deck (a stale
 * list held across a deck switch) yields nothing rather than a box at the
 * origin.
 */
export interface ZoneLabel {
  id: string
  name: string
  /** `13/08 – 19/08`, or '' when the zone has no dates. */
  range: string
  /** Normalised 0..1 against the drawing, like `Cell`. */
  x: number
  y: number
  w: number
  h: number
}

export function zoneLabelBoxes(
  zones: Zone[],
  cells: { id: string; x: number; y: number; w: number; h: number }[],
): ZoneLabel[] {
  const byId = new Map(cells.map((c) => [c.id, c]))
  const labels: ZoneLabel[] = []
  for (const zone of zones) {
    const mine = zone.cellIds.map((id) => byId.get(id)).filter((c) => c !== undefined)
    if (mine.length === 0) continue
    const left = Math.min(...mine.map((c) => c.x))
    const top = Math.min(...mine.map((c) => c.y))
    const right = Math.max(...mine.map((c) => c.x + c.w))
    const bottom = Math.max(...mine.map((c) => c.y + c.h))
    labels.push({
      id: zone.id,
      name: zone.name,
      range: formatPlanRange(zone.startDate, zone.finishDate),
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
    })
  }
  return labels
}

/**
 * The parts of a zone line, with the coat dropped when the zone's own name
 * already carries it (Feedback Rv3, item 3).
 *
 * The admin names zones after the coat they plan -- "Zone 3 — Coat 2" -- so
 * printing name, coat and dates gave "Zone 3 — Coat 2 · Coat 2 · 12/09 – 16/09".
 * Matched on a normalised, case-folded substring rather than on equality: the
 * name that caused this contains the coat, it does not equal it.
 */
export function describeZone(name: string, stageName: string, range: string): string {
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const stage = normalise(stageName)
  const redundant = stage !== '' && normalise(name).includes(stage)
  return [name, redundant ? '' : stageName, range].filter((part) => part.trim() !== '').join(' · ')
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
