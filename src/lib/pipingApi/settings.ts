import type { DayKey } from '../../domain/piping/types'
import { supabase } from '../supabase'
import { callRpc, isDayKey, requireRows, toError } from './shared'

/** Piping per project: read, enable, change, disable (spec §2, 0038 piping_settings / piping_enable). */

// The read lives on its own so the field pages load it without the admin's writers.
export { getPipingSettings } from './settingsRead'

/** What the admin types when enabling, and later in Cấu hình. */
export interface PipingSettingsInput {
  weekStartDate: DayKey
  /** Null: not entered yet; Reinstatement entries are refused until it is (R-4). */
  totalTestPacks: number | null
  lateThresholdDays: number
}

const MAX_INT = 2_147_483_647

/**
 * The same rules the table's CHECKs and piping_enable hold, in the
 * function's own words, checked first: a constraint message is not something
 * to show, and an `int` column refuses 1.5 in English.
 */
function checkSettings(input: PipingSettingsInput): void {
  if (!isDayKey(input.weekStartDate)) throw new Error('Cần chọn ngày bắt đầu tuần')
  const total = input.totalTestPacks
  // The column is `int`: above 2 147 483 647 it would fail in English (22003).
  if (total !== null && !(Number.isInteger(total) && total >= 0 && total <= MAX_INT)) {
    throw new Error('Tổng Test Pack phải là số nguyên từ 0 đến 2 147 483 647')
  }
  const n = input.lateThresholdDays
  if (!(Number.isInteger(n) && n >= 0 && n <= 365)) throw new Error('Ngưỡng trễ phải từ 0 đến 365 ngày')
}

/**
 * Enables (or re-enables) Piping with these settings. The function creates
 * the default manpower groups when the project has none. Admin only.
 */
export async function enablePiping(projectId: string, input: PipingSettingsInput): Promise<void> {
  checkSettings(input)
  await callRpc<null>('piping_enable', {
    p_project: projectId,
    p_week_start: input.weekStartDate,
    p_total_test_packs: input.totalTestPacks,
    p_late_threshold_days: input.lateThresholdDays,
  })
}

/** Cấu hình: changes the settings. Never rewrites stored data (weeks are display-time). Admin only. */
export async function updatePipingSettings(projectId: string, input: PipingSettingsInput): Promise<void> {
  checkSettings(input)
  const { data, error } = await supabase
    .from('piping_settings')
    .update({
      week_start_date: input.weekStartDate,
      total_test_packs: input.totalTestPacks,
      late_threshold_days: input.lateThresholdDays,
    })
    .eq('project_id', projectId)
    .select('project_id')
  if (error) throw toError(error)
  requireRows(data)
}

/** Hides the module for the project; every row of data is kept. Admin only. */
export async function disablePiping(projectId: string): Promise<void> {
  const { data, error } = await supabase
    .from('piping_settings')
    .update({ enabled: false })
    .eq('project_id', projectId)
    .select('project_id')
  if (error) throw toError(error)
  requireRows(data)
}
