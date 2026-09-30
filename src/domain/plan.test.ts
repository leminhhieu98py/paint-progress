import { describe, expect, it } from 'vitest'
import { describeZone, formatPlanRange, spreadLabelBoxes, zoneColorConflict, zoneLabelBoxes } from './plan'
import type { Stage, Zone } from './types'

describe('formatPlanRange', () => {
  it('renders a range the way the source drawing does', () => {
    // The CD source PDF annotates bays "13/08 to 19/08" -- day/month, no year --
    // a zone is five working days, so the year is never in doubt on site.
    expect(formatPlanRange('2026-08-13', '2026-08-19')).toBe('13/08 – 19/08')
  })

  it('renders a single date when only the start is known', () => {
    expect(formatPlanRange('2026-07-15', null)).toBe('15/07')
  })

  it('renders a single date when only the finish is known', () => {
    expect(formatPlanRange(null, '2026-07-15')).toBe('15/07')
  })

  it('renders nothing when neither is known', () => {
    // zones.start_date and finish_date are both nullable, and Phase 4's editor
    // will let a zone be grouped before it is scheduled.
    expect(formatPlanRange(null, null)).toBe('')
  })

  it('does not shift the date across a timezone', () => {
    // A date-only string parsed as UTC and formatted locally lands on the
    // previous day west of Greenwich, which would print every planned start one
    // day early. Asserted on the first of a month, where an off-by-one changes
    // the month too.
    expect(formatPlanRange('2026-03-01', '2026-03-05')).toBe('01/03 – 05/03')
  })
})

describe('zoneColorConflict', () => {
  const stages: Stage[] = [
    { id: 's1', seq: 1, name: 'Coat 1', color: '#fadb14', weight: 0.4 },
    { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.6 },
  ]

  it('names the stage whose colour the zone would borrow', () => {
    // Item 6: a zone in a stage colour reads as that stage on the drawing.
    expect(zoneColorConflict('#bfbfbf', stages)?.name).toBe('Coat 2')
  })

  it('is case-insensitive, because the picker and the database differ in case', () => {
    expect(zoneColorConflict('#BFBFBF', stages)?.name).toBe('Coat 2')
  })

  it('returns null for a colour no stage wears', () => {
    expect(zoneColorConflict('#eb2f96', stages)).toBeNull()
  })
})

describe('zoneLabelBoxes', () => {
  const cell = (id: string, x: number, y: number) => ({ id, x, y, w: 0.1, h: 0.1 })
  const CELLS = [cell('c1', 0.1, 0.1), cell('c2', 0.3, 0.1), cell('c3', 0.3, 0.4), cell('c4', 0.8, 0.8)]
  const zone = (over: Partial<Zone> = {}): Zone => ({
    id: 'z1', name: 'Zone (3)', stageId: 's1',
    startDate: '2026-10-06', finishDate: '2026-10-17', color: null,
    cellIds: ['c1', 'c2', 'c3'],
    ...over,
  })

  it('boxes the zone around its own bays, with the name and the range to draw', () => {
    expect(zoneLabelBoxes([zone()], CELLS)).toEqual([{
      id: 'z1', name: 'Zone (3)', range: '06/10 – 17/10',
      // From 0.1 to 0.4 across, 0.1 to 0.5 down.
      x: 0.1, y: 0.1, w: 0.30000000000000004, h: 0.4,
    }])
  })

  it('boxes a single bay as that bay', () => {
    const [label] = zoneLabelBoxes([zone({ cellIds: ['c4'] })], CELLS)
    expect(label.x).toBe(0.8)
    expect(label.y).toBe(0.8)
    expect(label.w).toBeCloseTo(0.1, 12)
    expect(label.h).toBeCloseTo(0.1, 12)
  })

  it('carries an empty range for a zone with no dates rather than dropping it', () => {
    const [label] = zoneLabelBoxes([zone({ startDate: null, finishDate: null })], CELLS)
    expect(label.range).toBe('')
    expect(label.name).toBe('Zone (3)')
  })

  it('skips a zone whose bays are not on this drawing', () => {
    // A zone list held across a deck switch would otherwise put a box at the
    // origin of the deck the foreman just opened.
    expect(zoneLabelBoxes([zone({ cellIds: ['gone'] })], CELLS)).toEqual([])
  })
})

describe('describeZone', () => {
  it('drops the coat when the zone name already carries it', () => {
    // Feedback Rv3, item 3: "Zone 3 — Coat 2 · Coat 2 · 12/09 – 16/09".
    expect(describeZone('Zone 3 — Coat 2', 'Coat 2', '12/09 – 16/09'))
      .toBe('Zone 3 — Coat 2 · 12/09 – 16/09')
  })

  it('matches the coat whatever the case and spacing', () => {
    expect(describeZone('Zone 3 — COAT  2', 'Coat 2', '12/09'))
      .toBe('Zone 3 — COAT  2 · 12/09')
  })

  it('keeps the coat when the name does not carry it', () => {
    expect(describeZone('Khu A', 'Coat 2', '12/09 – 16/09')).toBe('Khu A · Coat 2 · 12/09 – 16/09')
  })

  it('drops the empty parts instead of printing bare separators', () => {
    expect(describeZone('Khu A', '', '')).toBe('Khu A')
    expect(describeZone('Khu A', 'Coat 2', '')).toBe('Khu A · Coat 2')
  })
})

describe('spreadLabelBoxes (QA F7)', () => {
  const box = (id: string, x: number, y: number, w = 100, h = 30) => ({ id, x, y, w, h })
  const HEIGHT = 500

  it('leaves boxes that do not touch where they are', () => {
    const boxes = [box('a', 0, 0), box('b', 200, 0), box('c', 0, 100)]
    expect(spreadLabelBoxes(boxes, HEIGHT)).toEqual(boxes)
  })

  it('moves the later box down to just below the one it covers', () => {
    // Zone 1's label sat almost entirely under Zone 2's: two overlapping zone
    // boxes put both cards at nearly the same centre.
    expect(spreadLabelBoxes([box('a', 0, 100), box('b', 10, 110)], HEIGHT)).toEqual([
      box('a', 0, 100),
      box('b', 10, 130),
    ])
  })

  it('never moves the earlier box: the order is the zone order and it is stable', () => {
    const [first] = spreadLabelBoxes([box('a', 0, 100), box('b', 0, 100)], HEIGHT)
    expect(first).toEqual(box('a', 0, 100))
  })

  it('keeps moving a box that lands on a third one', () => {
    expect(spreadLabelBoxes([box('a', 0, 100), box('b', 0, 130), box('c', 0, 110)], HEIGHT)).toEqual([
      box('a', 0, 100),
      box('b', 0, 130),
      box('c', 0, 160),
    ])
  })

  it('moves up instead when going down would leave the drawing', () => {
    expect(spreadLabelBoxes([box('a', 0, 470), box('b', 0, 475)], HEIGHT)).toEqual([
      box('a', 0, 470),
      box('b', 0, 440),
    ])
  })

  it('does not count boxes that only share an edge as overlapping', () => {
    const boxes = [box('a', 0, 100), box('b', 0, 130), box('c', 100, 100)]
    expect(spreadLabelBoxes(boxes, HEIGHT)).toEqual(boxes)
  })

  it('leaves a box where it was when neither direction fits, rather than off the drawing', () => {
    // A visible overlap over a label that has been pushed out of sight.
    const boxes = [box('a', 0, 0, 100, 60), box('b', 0, 10, 100, 60)]
    expect(spreadLabelBoxes(boxes, 60)).toEqual(boxes)
  })

  it('keeps a gap between the boxes when asked', () => {
    expect(spreadLabelBoxes([box('a', 0, 100), box('b', 0, 100)], HEIGHT, 4)[1]).toEqual(box('b', 0, 134))
  })
})
