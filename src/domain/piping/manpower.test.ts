import { describe, expect, it } from 'vitest'
import { chartGroups, entryGroups, manpowerAverages, manpowerDays, manpowerSeries, valuesOnDay } from './manpower'
import type { ManpowerGroup, ManpowerValue } from './types'

const START = '2026-09-18'

const group = (id: string, sort: number, hidden = false): ManpowerGroup => ({ id, name: id.toUpperCase(), sort, hidden })
const v = (groupId: string, day: string, value: number): ManpowerValue => ({ groupId, day, value })

const groups = [group('ins', 2), group('reins', 1), group('mark', 3, true)]

describe('manpowerSeries, day view (spec §5)', () => {
  it('gives each group its own value per day and a total over the groups that have one', () => {
    const rows = manpowerSeries({
      groups,
      plan: [v('reins', '2026-09-18', 33), v('ins', '2026-09-18', 0), v('mark', '2026-09-18', 10)],
      actual: [v('reins', '2026-09-18', 30), v('ins', '2026-09-19', 5)],
      mode: 'day',
      weekStart: START,
      todayKey: '2026-09-19',
    })
    expect(rows.map((r) => r.key)).toEqual(['2026-09-18', '2026-09-19'])
    expect(rows[0].plan).toEqual({ reins: 33, ins: 0, mark: 10 })
    expect(rows[0].planTotal).toBe(43)
    expect(rows[0].actual).toEqual({ reins: 30, ins: null, mark: null })
    expect(rows[0].actualTotal).toBe(30)
    expect(rows[1].plan).toEqual({ reins: null, ins: null, mark: null })
    expect(rows[1].planTotal).toBeNull()
    expect(rows[1].actualTotal).toBe(5)
  })

  it('has no actual after today, while the plan runs on', () => {
    const rows = manpowerSeries({
      groups,
      plan: [v('reins', '2026-09-21', 40)],
      actual: [v('reins', '2026-09-19', 30)],
      mode: 'day',
      weekStart: START,
      todayKey: '2026-09-19',
    })
    const last = rows[rows.length - 1]
    expect(last.key).toBe('2026-09-21')
    expect(last.plan.reins).toBe(40)
    expect(last.actual).toEqual({ reins: null, ins: null, mark: null })
    expect(last.actualTotal).toBeNull()
  })
})

describe('manpowerSeries, week view: average of the days with a value (R-2)', () => {
  it('averages only the days that have an entry, an entered 0 included', () => {
    const rows = manpowerSeries({
      groups: [group('reins', 1)],
      plan: [],
      // 10, 0 and 20 entered on three days; four days with no entry do not count.
      actual: [v('reins', '2026-09-18', 10), v('reins', '2026-09-19', 0), v('reins', '2026-09-22', 20)],
      mode: 'week',
      weekStart: START,
      todayKey: '2026-09-24',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].actual.reins).toBe(10)
    expect(rows[0].actualTotal).toBe(10)
  })

  it('reads a plan imported one row per week as that week\'s value', () => {
    const rows = manpowerSeries({
      groups,
      plan: [v('reins', '2026-09-18', 33), v('ins', '2026-09-18', 0), v('mark', '2026-09-18', 10),
        v('reins', '2026-09-25', 36), v('ins', '2026-09-25', 20), v('mark', '2026-09-25', 10)],
      actual: [],
      mode: 'week',
      weekStart: START,
      todayKey: '2026-09-01',
    })
    expect(rows.map((r) => [r.key, r.plan, r.planTotal])).toEqual([
      ['2026-09-18', { reins: 33, ins: 0, mark: 10 }, 43],
      ['2026-09-25', { reins: 36, ins: 20, mark: 10 }, 66],
    ])
  })

  it('totals a week as the sum of the group averages, so the line meets the top of the stack', () => {
    const rows = manpowerSeries({
      groups: [group('a', 1), group('b', 2)],
      plan: [],
      actual: [v('a', '2026-09-18', 10), v('a', '2026-09-19', 10), v('b', '2026-09-18', 5)],
      mode: 'week',
      weekStart: START,
      todayKey: '2026-09-20',
    })
    expect(rows[0].actual).toEqual({ a: 10, b: 5 })
    expect(rows[0].actualTotal).toBe(15)
  })

  it('is empty with no values at all', () => {
    expect(manpowerSeries({ groups, plan: [], actual: [], mode: 'week', weekStart: START, todayKey: '2026-09-20' }))
      .toEqual([])
  })
})

describe('groups for the chart and for entry (R-8)', () => {
  it('keeps a hidden group in the chart while it has history, sorted by sort', () => {
    expect(chartGroups(groups, [v('mark', '2026-09-18', 10)], []).map((g) => g.id)).toEqual(['reins', 'ins', 'mark'])
    expect(chartGroups(groups, [], [v('mark', '2026-09-18', 1)]).map((g) => g.id)).toEqual(['reins', 'ins', 'mark'])
    expect(chartGroups(groups, [], []).map((g) => g.id)).toEqual(['reins', 'ins'])
  })

  it('offers only visible groups for entry, sorted by sort', () => {
    expect(entryGroups(groups).map((g) => g.id)).toEqual(['reins', 'ins'])
  })
})

describe('valuesOnDay', () => {
  it('maps each group to its value on the day', () => {
    expect(valuesOnDay([v('a', '2026-09-18', 1), v('b', '2026-09-18', 0), v('a', '2026-09-19', 3)], '2026-09-18'))
      .toEqual(new Map([['a', 1], ['b', 0]]))
  })
})

describe('manpowerAverages (spec §3, R-2, over the whole range)', () => {
  it('averages the daily totals over the days that have a value, an entered 0 included', () => {
    const avg = manpowerAverages({
      groups,
      plan: [v('reins', '2026-09-18', 30), v('ins', '2026-09-18', 10), v('reins', '2026-09-25', 20)],
      actual: [v('reins', '2026-09-18', 30), v('ins', '2026-09-19', 0), v('mark', '2026-09-19', 6)],
      todayKey: '2026-09-19',
    })
    // Plan: (40 + 20) / 2 days; Actual: (30 + 6) / 2 days -- the hidden group counts, an empty day does not.
    expect(avg).toEqual({ plan: 30, actual: 18 })
  })

  it('reads no actual after today and no value of an unknown group', () => {
    const avg = manpowerAverages({
      groups,
      plan: [v('gone', '2026-09-18', 99)],
      actual: [v('reins', '2026-09-18', 10), v('reins', '2026-09-20', 50)],
      todayKey: '2026-09-19',
    })
    expect(avg).toEqual({ plan: null, actual: 10 })
  })
})

describe('manpowerDays (the day grid of the tables)', () => {
  it('gives one row per day that has a value, oldest first, each group and the total', () => {
    const rows = manpowerDays(groups, [
      v('reins', '2026-09-20', 3), v('ins', '2026-09-18', 0), v('mark', '2026-09-18', 6), v('gone', '2026-09-19', 9),
    ])
    expect(rows).toEqual([
      { day: '2026-09-18', byGroup: { ins: 0, mark: 6 }, total: 6 },
      { day: '2026-09-20', byGroup: { reins: 3 }, total: 3 },
    ])
  })
})
