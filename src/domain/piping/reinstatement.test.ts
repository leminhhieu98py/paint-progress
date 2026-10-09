import { describe, expect, it } from 'vitest'
import {
  checkReinstatementEntry,
  reinstatementSeries,
  reinstatementSummary,
} from './reinstatement'
import type { ReinstatementActualEntry } from './types'

const START = '2026-09-18'

const entry = (id: string, day: string, qty: number): ReinstatementActualEntry => ({
  id, day, qty, createdBy: null, createdAt: null, editedBy: null, editedAt: null,
})

describe('reinstatementSeries (spec §4)', () => {
  const plan = [
    { day: '2026-09-18', planQty: 10 },
    { day: '2026-09-25', planQty: 20 },
  ]
  const actual = [entry('a', '2026-09-19', 4), entry('b', '2026-09-19', 3), entry('c', '2026-09-26', 5)]

  it('adds several entries on one day (R-3) and stops actual at today, plan at its end', () => {
    const rows = reinstatementSeries({ plan, actual, mode: 'day', weekStart: START, todayKey: '2026-09-27' })
    expect(rows[0].key).toBe('2026-09-18')
    expect(rows[rows.length - 1].key).toBe('2026-09-27')
    const at = (key: string) => rows.find((r) => r.key === key)!
    expect(at('2026-09-19')).toMatchObject({ plan: 0, planCum: 10, actual: 7, actualCum: 7 })
    expect(at('2026-09-25')).toMatchObject({ plan: 20, planCum: 30, actual: 0, actualCum: 7 })
    // The day after the plan's last day: plan gone, actual still running to today.
    expect(at('2026-09-26')).toMatchObject({ plan: null, planCum: null, actual: 5, actualCum: 12 })
  })

  it('runs the axis to the end of the plan when the plan outlasts today', () => {
    const rows = reinstatementSeries({ plan, actual: [], mode: 'week', weekStart: START, todayKey: '2026-09-20' })
    expect(rows.map((r) => [r.key, r.plan, r.planCum, r.actual, r.actualCum])).toEqual([
      ['2026-09-18', 10, 10, 0, 0],
      ['2026-09-25', 20, 30, null, null],
    ])
  })

  it('is empty with neither plan nor actual', () => {
    expect(reinstatementSeries({ plan: [], actual: [], mode: 'day', weekStart: START, todayKey: '2026-09-20' }))
      .toEqual([])
  })
})

describe('reinstatementSummary', () => {
  it('reads actual over total Test Pack, as the sample header 235/1022 – 22,99%', () => {
    const summary = reinstatementSummary([entry('a', '2026-09-19', 200), entry('b', '2026-09-20', 35)], 1022)
    expect(summary.actual).toBe(235)
    expect(summary.total).toBe(1022)
    expect(summary.ratio).toBeCloseTo(0.22994, 5)
  })

  it('has no ratio without a total, or with a total of 0', () => {
    expect(reinstatementSummary([entry('a', '2026-09-19', 5)], null)).toEqual({ actual: 5, total: null, ratio: null })
    expect(reinstatementSummary([], 0)).toEqual({ actual: 0, total: 0, ratio: null })
  })
})

describe('checkReinstatementEntry (spec §4, mirrors piping_add_reinstatement)', () => {
  const entries = [entry('a', '2026-09-19', 1000), entry('b', '2026-09-20', 15)]
  const base = { entries, totalTestPacks: 1022, todayKey: '2026-10-07' }

  it('accepts an entry within the cap on today or any past day', () => {
    expect(checkReinstatementEntry({ ...base, day: '2026-10-07', qty: 7 })).toBeNull()
    expect(checkReinstatementEntry({ ...base, day: '2025-01-01', qty: 1 })).toBeNull()
  })

  it('refuses a future day and a quantity that is not above 0', () => {
    expect(checkReinstatementEntry({ ...base, day: '2026-10-08', qty: 1 })).toBe('Ngày không được sau hôm nay')
    expect(checkReinstatementEntry({ ...base, day: '2026-10-07', qty: 0 })).toBe('Số lượng phải lớn hơn 0')
  })

  it('refuses an entry that would pass the total, naming what is already there', () => {
    expect(checkReinstatementEntry({ ...base, day: '2026-10-07', qty: 8 })).toBe('Vượt tổng Test Pack (đã có 1.015 / 1.022)')
  })

  it('refuses every entry while the total is not set (R-4)', () => {
    expect(checkReinstatementEntry({ ...base, totalTestPacks: null, day: '2026-10-07', qty: 1 }))
      .toBe('Admin chưa nhập tổng Test Pack')
  })

  it('leaves out the entry being edited when it raises the quantity', () => {
    expect(checkReinstatementEntry({ ...base, day: '2026-09-20', qty: 22, editing: { id: 'b', qty: 15 } })).toBeNull()
    expect(checkReinstatementEntry({ ...base, day: '2026-09-20', qty: 23, editing: { id: 'b', qty: 15 } }))
      .toBe('Vượt tổng Test Pack (đã có 1.000 / 1.022)')
  })

  it('caps an edit only when it raises the stored quantity, as the table trigger does', () => {
    // Over the cap already: the admin lowered the total below what was entered.
    const over = { ...base, totalTestPacks: 900 }
    expect(checkReinstatementEntry({ ...over, day: '2026-09-20', qty: 10, editing: { id: 'b', qty: 15 } })).toBeNull()
    expect(checkReinstatementEntry({ ...over, day: '2026-09-25', qty: 15, editing: { id: 'b', qty: 15 } })).toBeNull()
    expect(checkReinstatementEntry({ ...over, day: '2026-09-20', qty: 16, editing: { id: 'b', qty: 15 } }))
      .toBe('Vượt tổng Test Pack (đã có 1.000 / 900)')
    // No total set: lowering or keeping still passes; a raise is refused.
    const unset = { ...base, totalTestPacks: null }
    expect(checkReinstatementEntry({ ...unset, day: '2026-09-20', qty: 15, editing: { id: 'b', qty: 15 } })).toBeNull()
    expect(checkReinstatementEntry({ ...unset, day: '2026-09-20', qty: 16, editing: { id: 'b', qty: 15 } }))
      .toBe('Admin chưa nhập tổng Test Pack')
  })

  it('still refuses a future day and a quantity not above 0 on an edit', () => {
    expect(checkReinstatementEntry({ ...base, day: '2026-10-08', qty: 1, editing: { id: 'b', qty: 15 } }))
      .toBe('Ngày không được sau hôm nay')
    expect(checkReinstatementEntry({ ...base, day: '2026-09-20', qty: 0, editing: { id: 'b', qty: 15 } }))
      .toBe('Số lượng phải lớn hơn 0')
  })
})
