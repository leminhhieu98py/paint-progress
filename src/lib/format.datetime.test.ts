import { describe, expect, it } from 'vitest'
import { formatDateTimeVN, toVNExcelDate } from './format'

describe('formatDateTimeVN', () => {
  it('renders a UTC instant as Vietnam wall-clock, time first', () => {
    // 14:41:51 UTC is 21:41:51 in Vietnam. The workbook a customer opens has to
    // say the hour the foreman was standing on the deck, not the hour in London.
    expect(formatDateTimeVN('2026-08-28T14:41:51.023092+00:00'))
      .toBe('21:41:51 28/08/2026')
  })

  it('carries the date over midnight, which is where a naive offset breaks', () => {
    // 18:30 UTC on the 28th is 01:30 on the 29th in Vietnam. Formatting the
    // time from the shifted value and the date from the original would print
    // 01:30 28/08 -- a whole day wrong, on the column an invoice is checked
    // against.
    expect(formatDateTimeVN('2026-08-28T18:30:00Z')).toBe('01:30:00 29/08/2026')
  })

  it('respects an offset already in the string', () => {
    // Postgres hands back +00:00, but a value that arrives as +07:00 is the
    // same instant and must not be shifted twice.
    expect(formatDateTimeVN('2026-08-28T21:41:51+07:00')).toBe('21:41:51 28/08/2026')
  })

  it('pads every field, so the column lines up and sorts as text', () => {
    expect(formatDateTimeVN('2026-01-05T02:03:04Z')).toBe('09:03:04 05/01/2026')
  })

  it('is blank for a bay nobody has touched', () => {
    // cells.updated_at is null until someone records a coat. "Invalid Date" in
    // two hundred rows is worse than an empty column.
    expect(formatDateTimeVN(null)).toBe('')
    expect(formatDateTimeVN(undefined)).toBe('')
    expect(formatDateTimeVN('')).toBe('')
    expect(formatDateTimeVN('không phải ngày')).toBe('')
  })
})

describe('toVNExcelDate', () => {
  it('puts the Vietnam wall clock in the UTC fields Excel reads', () => {
    // Excel has no timezone: it renders the serial verbatim, and ExcelJS
    // derives that serial from the Date's UTC value. A real UTC Date would
    // display seven hours early on every machine that opened the file.
    const d = toVNExcelDate('2026-08-28T14:41:51Z')!
    expect(d.getUTCHours()).toBe(21)
    expect(d.getUTCDate()).toBe(28)
    expect(d.getUTCMonth() + 1).toBe(8)
  })

  it('is null for a missing or unparseable value', () => {
    expect(toVNExcelDate(null)).toBeNull()
    expect(toVNExcelDate('không phải ngày')).toBeNull()
  })
})
