import { describe, expect, it } from 'vitest'
import { daysUntil, deckForecast } from './forecast'
import type { StageEfficiency } from './effort'
import type { Stage, StageProgress } from './types'

const stage = (id: string, seq: number, name: string): Stage => ({
  id, seq, name, color: '#000000', weight: 0.25,
})

/**
 * Linh's workbook, "Cách tính số Mhr và ngày còn lại.xlsx": four coats of one
 * deck, each with its own measured efficiency, its own average day, and its
 * own remaining area. The expected outputs below are the workbook's own cells
 * (N4/O4, N11/O11, N17/O17, N21/O21, U5, U6).
 */
const WORKBOOK = [
  { name: 'Lớp 1', avgMhrPerM2: 1.2016900772430186, avgHoursPerDay: 288.8, remaining: 500 },
  { name: 'Lớp 2', avgMhrPerM2: 1.1873398692810457, avgHoursPerDay: 291.75, remaining: 800 },
  { name: 'Lớp 3', avgMhrPerM2: 1.0142241379310344, avgHoursPerDay: 289, remaining: 1200 },
  { name: 'Lớp 4', avgMhrPerM2: 2.3333333333333335, avgHoursPerDay: 350, remaining: 900 },
]

const TOTAL_AREA = 2000

const stages = WORKBOOK.map((w, i) => stage(`s${i + 1}`, i + 1, w.name))

/** Cumulative area at each coat that leaves the workbook's remaining areas. */
const stageProgress: StageProgress[] = WORKBOOK.map((w, i) => ({
  stage: stages[i],
  cumulativeAreaM2: TOTAL_AREA - w.remaining,
  ratio: (TOTAL_AREA - w.remaining) / TOTAL_AREA,
}))

const efficiency: StageEfficiency[] = WORKBOOK.map((w) => ({
  workName: 'Sơn',
  stageName: w.name,
  days: 5,
  totalHours: 0,
  totalAreaM2: 0,
  avgMhrPerM2: w.avgMhrPerM2,
  avgHoursPerDay: w.avgHoursPerDay,
  wasteHours: 0,
}))

const forecast = (over: Partial<Parameters<typeof deckForecast>[0]> = {}) => deckForecast({
  totalAreaM2: TOTAL_AREA,
  stages,
  stageProgress,
  efficiency,
  deadline: null,
  today: '2026-09-05',
  ...over,
})

describe('daysUntil', () => {
  it('counts calendar days with both ends included, so a deadline today is one day of work', () => {
    expect(daysUntil('2026-09-05', '2026-09-05')).toBe(1)
    expect(daysUntil('2026-09-05', '2026-09-06')).toBe(2)
  })

  it('counts Sundays like any other day, as Linh asked', () => {
    // 05/09/2026 is a Saturday; 06/09 is a Sunday. Three days, not two.
    expect(daysUntil('2026-09-05', '2026-09-07')).toBe(3)
  })

  it('crosses a month and a leap day', () => {
    expect(daysUntil('2026-08-30', '2026-09-02')).toBe(4)
    expect(daysUntil('2028-02-27', '2028-03-01')).toBe(4)
  })

  it('goes zero and negative once the deadline has passed', () => {
    expect(daysUntil('2026-09-05', '2026-09-04')).toBe(0)
    expect(daysUntil('2026-09-05', '2026-09-01')).toBe(-3)
  })
})

describe('deckForecast', () => {
  it('reproduces the workbook: Mhr needed and days per coat', () => {
    const f = forecast()
    expect(f.stages.map((s) => s.stageName)).toEqual(['Lớp 1', 'Lớp 2', 'Lớp 3', 'Lớp 4'])
    expect(f.stages[0].remainingAreaM2).toBe(500)
    expect(f.stages[0].mhrNeeded).toBeCloseTo(600.8450386215093, 9)
    expect(f.stages.map((s) => s.daysNeeded)).toEqual([3, 4, 5, 6])
    expect(f.stages[1].mhrNeeded).toBeCloseTo(949.8718954248366, 9)
    expect(f.stages[2].mhrNeeded).toBeCloseTo(1217.0689655172412, 9)
    expect(f.stages[3].mhrNeeded).toBeCloseTo(2100, 9)
  })

  it('totals the Mhr and takes the MAX of the days, because the coats run in parallel', () => {
    const f = forecast()
    expect(f.totalMhrNeeded).toBeCloseTo(4867.785899563587, 9)
    // Linh: "Tính ngày Max vì làm song song". The sum would be 18.
    expect(f.daysNeeded).toBe(6)
  })

  it('leaves a finished coat out of the days but keeps it on the list at zero', () => {
    const done = stageProgress.map((sp, i) => (
      i === 3 ? { ...sp, cumulativeAreaM2: TOTAL_AREA, ratio: 1 } : sp
    ))
    const f = forecast({ stageProgress: done })
    expect(f.stages[3]).toMatchObject({ remainingAreaM2: 0, mhrNeeded: 0, daysNeeded: 0 })
    expect(f.daysNeeded).toBe(5)
  })

  it('prints a coat with no measured efficiency as unknown and says how many are missing', () => {
    const f = forecast({ efficiency: efficiency.slice(0, 2) })
    expect(f.stages[2]).toMatchObject({ avgMhrPerM2: null, mhrNeeded: null, daysNeeded: null })
    expect(f.stagesWithoutData).toBe(2)
    // The totals cover only the coats that have data, and say so through the count.
    expect(f.totalMhrNeeded).toBeCloseTo(600.8450386215093 + 949.8718954248366, 9)
    expect(f.daysNeeded).toBe(4)
  })

  it('has no total at all when nothing has been measured yet', () => {
    const f = forecast({ efficiency: [] })
    expect(f.totalMhrNeeded).toBeNull()
    expect(f.daysNeeded).toBeNull()
    expect(f.stagesWithoutData).toBe(4)
  })

  it('carries no warning without a deadline', () => {
    const f = forecast()
    expect(f.deadline).toBeNull()
    expect(f.daysRemaining).toBeNull()
    expect(f.lateDays).toBeNull()
    expect(f.shortfallMhr).toBeNull()
  })

  it('is on time when the days left cover the days needed', () => {
    // 6 days needed, 10 left.
    const f = forecast({ deadline: '2026-09-14' })
    expect(f.daysRemaining).toBe(10)
    expect(f.lateDays).toBeNull()
    expect(f.shortfallMhr).toBeNull()
  })

  it('says how many days late and how many Mhr short when the deadline cannot be met', () => {
    // 4 days left, 6 needed -> 2 days late.
    const f = forecast({ deadline: '2026-09-08' })
    expect(f.daysRemaining).toBe(4)
    expect(f.lateDays).toBe(2)
    // Only the coats that cannot finish in 4 days contribute, and only by
    // what they miss by: Lớp 3 (1217.07 - 4*289) and Lớp 4 (2100 - 4*350).
    expect(f.shortfallMhr).toBeCloseTo((1217.0689655172412 - 1156) + (2100 - 1400), 9)
  })

  it('counts the whole job as short once the deadline has passed', () => {
    const f = forecast({ deadline: '2026-09-01' })
    expect(f.daysRemaining).toBe(-3)
    expect(f.lateDays).toBe(9)
    expect(f.shortfallMhr).toBeCloseTo(4867.785899563587, 9)
  })

  it('orders the coats by seq, whatever order the efficiency rows arrive in', () => {
    const f = forecast({ efficiency: [...efficiency].reverse() })
    expect(f.stages.map((s) => s.seq)).toEqual([1, 2, 3, 4])
  })

  it('returns an empty forecast for a work with no coats rather than throwing', () => {
    const f = forecast({ stages: [], stageProgress: [], efficiency: [] })
    expect(f.stages).toEqual([])
    expect(f.totalMhrNeeded).toBeNull()
    expect(f.daysNeeded).toBeNull()
  })
})
