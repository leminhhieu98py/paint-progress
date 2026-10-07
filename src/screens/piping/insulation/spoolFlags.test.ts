import { describe, expect, it } from 'vitest'
import { spoolFlagItems } from './spoolFlags'

const NONE = { duplicate: false, planOrder: false, late: [] }

describe('spoolFlagItems (spec §6.2, §6.4)', () => {
  it('shows the admin a duplicate SpoolNo and a plan-order issue', () => {
    expect(spoolFlagItems({ ...NONE, duplicate: true, planOrder: true }, true).map((f) => f.label))
      .toEqual(['SpoolNo trùng', 'Sai thứ tự Plan'])
  })

  it('shows nothing for a spool without flags', () => {
    expect(spoolFlagItems(NONE, true)).toEqual([])
  })

  it('keeps the review flags from a foreman and a viewer', () => {
    expect(spoolFlagItems({ ...NONE, duplicate: true, planOrder: true }, false)).toEqual([])
  })
})
