import { describe, expect, it } from 'vitest'
import type { CamSpoolFlags } from '../../../domain/piping/cam'
import { spoolFlagItems } from './spoolFlags'

const NONE: CamSpoolFlags = { duplicate: false, planOrder: false, late: [] }
const labels = (flags: CamSpoolFlags, admin: boolean) => spoolFlagItems(flags, admin).map((f) => f.label)

describe('spoolFlagItems (spec §6.2, §6.4, §7)', () => {
  it('shows the admin a duplicate SpoolNo, a plan-order issue and each late milestone', () => {
    expect(labels({ duplicate: true, planOrder: true, late: ['ph', 'iw'] }, true))
      .toEqual(['SpoolNo trùng', 'Sai thứ tự Plan', 'Trễ Painting Handover', 'Trễ Insulation Work'])
  })

  it('shows nothing for a spool without flags', () => {
    expect(spoolFlagItems(NONE, true)).toEqual([])
  })

  it('shows a foreman or a viewer the late milestones but not the review flags', () => {
    expect(labels({ duplicate: true, planOrder: true, late: ['ih'] }, false)).toEqual(['Trễ Insulation Handover'])
  })
})
