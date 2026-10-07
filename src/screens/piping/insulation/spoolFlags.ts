import type { StatusTone } from '../../../components/StatusPill'
import { MILESTONE_LABEL, type CamSpoolFlags } from '../../../domain/piping/cam'

/** One badge in a Spool row's Cảnh báo column. */
export interface SpoolFlagItem {
  key: string
  label: string
  tone: StatusTone
}

/**
 * The badges a Spool row shows (spec §6.4), from `camSpoolFlags`. A duplicate
 * SpoolNo (Q14C) and a plan-order issue (Q15B) are for the admin to review,
 * so only the admin sees them; a late milestone (spec §7) is for everyone,
 * one badge per milestone in PH, IH, IW order.
 */
export function spoolFlagItems(flags: CamSpoolFlags, admin: boolean): SpoolFlagItem[] {
  const out: SpoolFlagItem[] = []
  if (admin && flags.duplicate) out.push({ key: 'duplicate', label: 'SpoolNo trùng', tone: 'warn' })
  if (admin && flags.planOrder) out.push({ key: 'planOrder', label: 'Sai thứ tự Plan', tone: 'warn' })
  for (const m of flags.late) out.push({ key: `late-${m}`, label: `Trễ ${MILESTONE_LABEL[m]}`, tone: 'warn' })
  return out
}
