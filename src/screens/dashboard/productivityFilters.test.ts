import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRODUCTIVITY_FILTERS, productivityFilterCount, productivitySummary } from './productivityFilters'

const WORKS = ['Sơn', 'Tháo giáo']

describe('productivityFilterCount (FLT-04)', () => {
  it('counts nothing on the defaults, nor on the first work chosen by name', () => {
    expect(productivityFilterCount(DEFAULT_PRODUCTIVITY_FILTERS, WORKS)).toBe(0)
    expect(productivityFilterCount({ ...DEFAULT_PRODUCTIVITY_FILTERS, work: 'Sơn' }, WORKS)).toBe(0)
  })

  it('counts another work, a deck and a date range, the range once whichever end is set', () => {
    expect(productivityFilterCount({ work: 'Tháo giáo', deck: 'Sàn A', range: [dayjs('2026-09-01'), null] }, WORKS)).toBe(3)
    expect(productivityFilterCount({ ...DEFAULT_PRODUCTIVITY_FILTERS, range: [dayjs('2026-09-01'), dayjs('2026-09-30')] }, WORKS)).toBe(1)
  })
})

describe('productivitySummary (FLT-04)', () => {
  it('reads project · deck · work, Tất cả sàn for every deck and the first work by default', () => {
    expect(productivitySummary('DEMO', DEFAULT_PRODUCTIVITY_FILTERS, WORKS)).toBe('DEMO · Tất cả sàn · Sơn')
    expect(productivitySummary('DEMO', { ...DEFAULT_PRODUCTIVITY_FILTERS, deck: 'Sàn A', work: 'Tháo giáo' }, WORKS))
      .toBe('DEMO · Sàn A · Tháo giáo')
  })

  it('adds the dates when set, and leaves out what is not known yet', () => {
    const range = [dayjs('2026-09-01'), dayjs('2026-09-30')] as const
    expect(productivitySummary('DEMO', { ...DEFAULT_PRODUCTIVITY_FILTERS, range: [...range] }, WORKS))
      .toBe('DEMO · Tất cả sàn · Sơn · 01/09/2026 – 30/09/2026')
    expect(productivitySummary(undefined, { ...DEFAULT_PRODUCTIVITY_FILTERS, range: [range[0], null] }, []))
      .toBe('Tất cả sàn · Từ 01/09/2026')
    expect(productivitySummary(undefined, { ...DEFAULT_PRODUCTIVITY_FILTERS, range: [null, range[1]] }, ['']))
      .toBe('Tất cả sàn · (không rõ công việc) · Đến 30/09/2026')
  })
})
