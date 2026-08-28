import { describe, expect, it } from 'vitest'
import { buildPlanLabels, buildZoneMarkerLabels, formatPlanRange, zoneMarkers } from './plan'
import type { Zone } from './types'

const CELLS = [
  { id: 'c1', code: 'R1C1' },
  { id: 'c2', code: 'R1C2' },
  { id: 'c3', code: 'R2C1' },
]

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

describe('buildPlanLabels', () => {
  const zone: Zone = {
    id: 'z1', name: 'Zone 1', stageId: 's5',
    startDate: '2026-08-13', finishDate: '2026-08-19',
    cellIds: ['c1', 'c2'],
  }

  it('labels every cell in the zone, by code', () => {
    // Keyed by CODE because that is what DrawingCanvas keys on; the zone knows
    // only cell ids.
    expect(buildPlanLabels([zone], CELLS)).toEqual({
      R1C1: '13/08 – 19/08',
      R1C2: '13/08 – 19/08',
    })
  })

  it('leaves cells outside every zone unlabelled', () => {
    expect(buildPlanLabels([zone], CELLS).R2C1).toBeUndefined()
  })

  it('falls back to the zone\'s name when it has no dates', () => {
    // An unscheduled zone must still be visible as a zone -- an empty label
    // would draw a dashed outline with nothing to explain it.
    expect(buildPlanLabels([{ ...zone, startDate: null, finishDate: null }], CELLS))
      .toEqual({ R1C1: 'Zone 1', R1C2: 'Zone 1' })
  })

  it('ignores a cell id that is not on this deck', () => {
    // zone_cells cascades on cell_id, so this should not happen -- but a stale
    // zone list held across a deck switch would otherwise put another deck's
    // labels on this drawing.
    expect(buildPlanLabels([{ ...zone, cellIds: ['c1', 'ghost'] }], CELLS))
      .toEqual({ R1C1: '13/08 – 19/08' })
  })

  it('lets a later zone win a cell both claim', () => {
    // zones are ordered by seq, so "later" is the higher seq -- the more recent
    // plan for that bay.
    const second: Zone = {
      id: 'z2', name: 'Zone 2', stageId: 's5',
      startDate: '2026-09-01', finishDate: '2026-09-05', cellIds: ['c1'],
    }
    expect(buildPlanLabels([zone, second], CELLS).R1C1).toBe('01/09 – 05/09')
  })

  it('returns nothing when there are no zones', () => {
    // The state this ships in: Phase 4 builds the zone editor, so until then
    // every deck has zero zones and the toggle must draw nothing at all.
    expect(buildPlanLabels([], CELLS)).toEqual({})
  })
})

describe('zoneMarkers', () => {
  it('numbers the zones in the order they were given', () => {
    expect(zoneMarkers([
      { id: 'a', name: 'Khu A', stageId: 's1', startDate: null, finishDate: null, cellIds: [] },
      { id: 'b', name: 'Khu B', stageId: 's1', startDate: null, finishDate: null, cellIds: [] },
    ])).toEqual({ a: 'Z1', b: 'Z2' })
  })

  it('returns nothing for a deck with no plan', () => {
    expect(zoneMarkers([])).toEqual({})
  })
})

describe('buildZoneMarkerLabels', () => {
  const cells = [
    { id: 'c1', code: 'R1C1' },
    { id: 'c2', code: 'R1C2' },
    { id: 'c3', code: 'R2C1' },
  ]
  const zone = (id: string, cellIds: string[]) => ({
    id, name: id, stageId: 's1', startDate: '2026-09-01', finishDate: '2026-09-12', cellIds,
  })

  it('marks every bay of a zone with that zone\'s number', () => {
    // Two or three characters fit almost anywhere; the thirteen of a date range
    // do not, which is why a real deck went silent about a plan that existed.
    expect(buildZoneMarkerLabels([zone('a', ['c1', 'c2'])], cells)).toEqual({
      R1C1: 'Z1', R1C2: 'Z1',
    })
  })

  it('gives each zone its own number', () => {
    const labels = buildZoneMarkerLabels([zone('a', ['c1']), zone('b', ['c3'])], cells)
    expect(labels).toEqual({ R1C1: 'Z1', R2C1: 'Z2' })
  })

  it('lets a later zone win a bay both claim', () => {
    // Same rule buildPlanLabels follows: a higher seq is the more recent plan.
    expect(buildZoneMarkerLabels([zone('a', ['c1']), zone('b', ['c1'])], cells).R1C1).toBe('Z2')
  })

  it('ignores a cell id that is not on this deck', () => {
    expect(buildZoneMarkerLabels([zone('a', ['c1', 'nope'])], cells)).toEqual({ R1C1: 'Z1' })
  })

  it('leaves a bay in no zone unlabelled', () => {
    expect(buildZoneMarkerLabels([zone('a', ['c1'])], cells).R2C1).toBeUndefined()
  })
})
