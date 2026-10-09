import { describe, expect, it } from 'vitest'
import {
  addDays,
  buckets,
  daysBetween,
  formatDayMonth,
  formatDayMonthYear,
  seriesSpan,
  weekIndex,
  weekLabel,
  weekRange,
  weekRangeLabel,
} from './week'

// 2026-09-18 is the sample workbook's first Manpower week (a Friday).
const START = '2026-09-18'

describe('addDays / daysBetween', () => {
  it('walks calendar days across month and year ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-09-18', 0)).toBe('2026-09-18')
  })

  it('counts whole days from the first to the second, negative when inverted', () => {
    expect(daysBetween('2026-09-18', '2026-09-25')).toBe(7)
    expect(daysBetween('2026-09-25', '2026-09-18')).toBe(-7)
    // Vietnam has no DST, but the browser running this may: UTC noon keeps it whole.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
  })
})

describe('weekIndex / weekRange (spec §3)', () => {
  it('puts the start date and the six days after it in week 0', () => {
    expect(weekIndex('2026-09-18', START)).toBe(0)
    expect(weekIndex('2026-09-24', START)).toBe(0)
    expect(weekIndex('2026-09-25', START)).toBe(1)
  })

  it('puts days before the start date in negative weeks', () => {
    expect(weekIndex('2026-09-17', START)).toBe(-1)
    expect(weekIndex('2026-09-11', START)).toBe(-1)
    expect(weekIndex('2026-09-10', START)).toBe(-2)
  })

  it('returns the 7-day window of week k, negative k included', () => {
    expect(weekRange(0, START)).toEqual({ start: '2026-09-18', end: '2026-09-24' })
    expect(weekRange(2, START)).toEqual({ start: '2026-10-02', end: '2026-10-08' })
    expect(weekRange(-1, START)).toEqual({ start: '2026-09-11', end: '2026-09-17' })
  })
})

describe('labels (Q6A)', () => {
  it('labels a week by its first day DD/MM, the tooltip by DD/MM – DD/MM', () => {
    expect(formatDayMonth('2026-09-08')).toBe('08/09')
    expect(formatDayMonthYear('2026-09-08')).toBe('08/09/2026')
    expect(weekLabel(1, START)).toBe('25/09')
    expect(weekRangeLabel(1, START)).toBe('25/09 – 01/10')
  })
})

describe('buckets', () => {
  it('gives one bucket per calendar day in day view', () => {
    expect(buckets('2026-09-30', '2026-10-02', 'day', START)).toEqual([
      { key: '2026-09-30', start: '2026-09-30', end: '2026-09-30', label: '30/09', tooltip: '30/09/2026' },
      { key: '2026-10-01', start: '2026-10-01', end: '2026-10-01', label: '01/10', tooltip: '01/10/2026' },
      { key: '2026-10-02', start: '2026-10-02', end: '2026-10-02', label: '02/10', tooltip: '02/10/2026' },
    ])
  })

  it('gives every week touching the range in week view, keyed by the first day', () => {
    expect(buckets('2026-09-16', '2026-09-26', 'week', START)).toEqual([
      { key: '2026-09-11', start: '2026-09-11', end: '2026-09-17', label: '11/09', tooltip: '11/09 – 17/09' },
      { key: '2026-09-18', start: '2026-09-18', end: '2026-09-24', label: '18/09', tooltip: '18/09 – 24/09' },
      { key: '2026-09-25', start: '2026-09-25', end: '2026-10-01', label: '25/09', tooltip: '25/09 – 01/10' },
    ])
  })

  it('is a single bucket for an inverted range rather than nothing', () => {
    expect(buckets('2026-09-20', '2026-09-19', 'day', START).map((b) => b.key)).toEqual(['2026-09-20'])
  })
})

describe('seriesSpan', () => {
  it('runs from the first data day to the last, or to today when today is later', () => {
    expect(seriesSpan(['2026-09-20', '2026-09-01', '2026-10-30'], '2026-10-07'))
      .toEqual({ from: '2026-09-01', to: '2026-10-30' })
    expect(seriesSpan(['2026-09-20', '2026-09-01'], '2026-10-07'))
      .toEqual({ from: '2026-09-01', to: '2026-10-07' })
  })

  it('does not reach back to today when every data day is in the future', () => {
    expect(seriesSpan(['2026-11-01', '2026-11-20'], '2026-10-07'))
      .toEqual({ from: '2026-11-01', to: '2026-11-20' })
  })

  it('is null without data', () => {
    expect(seriesSpan([], '2026-10-07')).toBeNull()
  })
})
