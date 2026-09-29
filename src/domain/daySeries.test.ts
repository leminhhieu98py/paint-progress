import { describe, expect, it } from 'vitest'
import { padDays } from './daySeries'

describe('padDays (QA F4)', () => {
  it('fills every calendar day between the first and the last with nulls for each series', () => {
    // 27/08 and 30/08 and 05/09 plotted three evenly spaced points, and the
    // line joined 30/08 to 05/09 across five days nobody worked.
    expect(padDays([
      { day: '2026-08-30', 'Lớp 1': 1.2, 'Lớp 2': 1.1 },
      { day: '2026-09-01', 'Lớp 1': 1.1 },
    ])).toEqual([
      { day: '2026-08-30', 'Lớp 1': 1.2, 'Lớp 2': 1.1 },
      { day: '2026-08-31', 'Lớp 1': null, 'Lớp 2': null },
      { day: '2026-09-01', 'Lớp 1': 1.1 },
    ])
  })

  it('leaves a contiguous series exactly as it is', () => {
    const series = [
      { day: '2026-09-01', hours: 230, wasteHours: 3 },
      { day: '2026-09-02', hours: 220, wasteHours: 0 },
    ]
    expect(padDays(series)).toEqual(series)
  })

  it('orders the days ascending whatever order the rows arrive in', () => {
    expect(padDays([
      { day: '2026-09-03', hours: 1, wasteHours: 0 },
      { day: '2026-09-01', hours: 2, wasteHours: 0 },
    ]).map((r) => r.day)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })

  it('is a single day for a single day, and nothing for nothing', () => {
    expect(padDays([{ day: '2026-09-01', hours: 1, wasteHours: 0 }])).toEqual([
      { day: '2026-09-01', hours: 1, wasteHours: 0 },
    ])
    expect(padDays([])).toEqual([])
  })
})
