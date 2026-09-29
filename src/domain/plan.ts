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

/** An axis-aligned box in whatever unit the caller draws in. */
export interface LabelBox {
  x: number
  y: number
  w: number
  h: number
}

const boxesOverlap = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * The zone cards moved apart so none covers another (QA F7).
 *
 * Two zones whose bays overlap put both cards at nearly the same centre, and
 * "Zone 1 — Tháo giáo 15/11–20/11" sat unreadable under "Zone 2 21/11–26/11".
 * Each box is taken in the order given -- the zone order, so the outcome is
 * the same on every render and the first zone's card never moves -- and, when
 * it overlaps a box already placed, is moved DOWN by the least that clears
 * every placed box; up instead when every downward spot would leave the
 * drawing (`height`); and left where it was when neither direction fits,
 * because a visible overlap still beats a card pushed out of sight.
 *
 * Boxes that only share an edge do not overlap. `gap` keeps a little air
 * between cards. Pure and unit-free: the canvas calls it in pixels once it
 * knows how big each card is, so the same pass serves the admin's drawing and
 * the foreman's.
 */
export function spreadLabelBoxes<T extends LabelBox>(boxes: T[], height: number, gap = 0): T[] {
  const placed: T[] = []
  for (const box of boxes) {
    const clear = (y: number) => !placed.some((p) => boxesOverlap({ ...box, y }, p))
    let next = box
    if (!clear(box.y)) {
      // Nearest first, so the shift is the least that resolves the overlap.
      const down = placed
        .map((p) => p.y + p.h + gap)
        .filter((y) => y > box.y && y + box.h <= height)
        .sort((a, b) => a - b)
        .find(clear)
      const up = down === undefined
        ? placed
            .map((p) => p.y - box.h - gap)
            .filter((y) => y < box.y && y >= 0)
            .sort((a, b) => b - a)
            .find(clear)
        : undefined
      const y = down ?? up
      if (y !== undefined) next = { ...box, y }
    }
    placed.push(next)
  }
  return placed
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
