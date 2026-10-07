import type { StatusTone } from '../../../components/StatusPill'
import type { CamSpoolFlags } from '../../../domain/piping/cam'

/** One badge in a Spool row's Cảnh báo column. */
export interface SpoolFlagItem {
  key: string
  label: string
  tone: StatusTone
}

/**
 * The badges a Spool row shows (spec §6.4), from `camSpoolFlags`. A duplicate
 * SpoolNo (Q14C) and a plan-order issue (Q15B) are for the admin to review,
 * so only the admin sees them. The late flag (spec §7), which everyone sees,
 * is added here by the late-warnings task; `CamSpoolFlags.late` already
 * carries it.
 */
export function spoolFlagItems(flags: CamSpoolFlags, admin: boolean): SpoolFlagItem[] {
  const out: SpoolFlagItem[] = []
  if (admin && flags.duplicate) out.push({ key: 'duplicate', label: 'SpoolNo trùng', tone: 'warn' })
  if (admin && flags.planOrder) out.push({ key: 'planOrder', label: 'Sai thứ tự Plan', tone: 'warn' })
  return out
}

/** Whether the Cảnh báo column is shown at all: today only the admin has flags to see. */
export const showsSpoolFlags = (admin: boolean) => admin
