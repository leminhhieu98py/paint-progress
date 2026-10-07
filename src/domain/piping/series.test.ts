import { describe, expect, it } from 'vitest'
import { barCumSeries, sumByDay } from './series'
import { buckets } from './week'

const START = '2026-09-18'

describe('sumByDay', () => {
  it('adds up several amounts on one day', () => {
    expect(sumByDay([
      { day: '2026-09-20', value: 2 },
      { day: '2026-09-19', value: 1 },
      { day: '2026-09-20', value: 3 },
    ])).toEqual(new Map([['2026-09-19', 1], ['2026-09-20', 5]]))
  })
})

describe('barCumSeries', () => {
  const days = buckets('2026-09-18', '2026-09-23', 'day', START)
  const plan = new Map([['2026-09-18', 10], ['2026-09-20', 5], ['2026-09-21', 5]])
  const actual = new Map([['2026-09-18', 4], ['2026-09-19', 6]])

  it('gives each day its own bars and the running totals', () => {
    const rows = barCumSeries({ buckets: days, plan, actual, planEnd: '2026-09-21', todayKey: '2026-09-20' })
    expect(rows.map((r) => [r.key, r.plan, r.planCum, r.actual, r.actualCum])).toEqual([
      ['2026-09-18', 10, 10, 4, 4],
      ['2026-09-19', 0, 10, 6, 10],
      ['2026-09-20', 5, 15, 0, 10],
      // Plan runs to its end; actual stops at today.
      ['2026-09-21', 5, 20, null, null],
      ['2026-09-22', null, null, null, null],
      ['2026-09-23', null, null, null, null],
    ])
  })

  it('sums each week and accumulates to the week end, actual to today inside the current week', () => {
    const weeks = buckets('2026-09-11', '2026-10-01', 'week', START)
    const rows = barCumSeries({
      buckets: weeks,
      plan: new Map([['2026-09-12', 3], ['2026-09-18', 10], ['2026-09-24', 5], ['2026-09-30', 7]]),
      actual: new Map([['2026-09-15', 2], ['2026-09-19', 6]]),
      planEnd: '2026-09-30',
      todayKey: '2026-09-20',
    })
    expect(rows.map((r) => [r.key, r.plan, r.planCum, r.actual, r.actualCum])).toEqual([
      ['2026-09-11', 3, 3, 2, 2],
      ['2026-09-18', 15, 18, 6, 8],
      ['2026-09-25', 7, 25, null, null],
    ])
  })

  it('leaves every plan value null without a plan, and actual at 0 up to today without entries', () => {
    const rows = barCumSeries({ buckets: days.slice(0, 3), plan: new Map(), actual: new Map(), planEnd: null, todayKey: '2026-09-19' })
    expect(rows.map((r) => [r.plan, r.planCum, r.actual, r.actualCum])).toEqual([
      [null, null, 0, 0],
      [null, null, 0, 0],
      [null, null, null, null],
    ])
  })

  it('carries the bucket fields through', () => {
    const [row] = barCumSeries({ buckets: days.slice(0, 1), plan, actual, planEnd: '2026-09-21', todayKey: '2026-09-20' })
    expect(row).toMatchObject({ key: '2026-09-18', label: '18/09', tooltip: '18/09/2026' })
  })
})
