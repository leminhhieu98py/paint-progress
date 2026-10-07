import type { DayKey, PipingSettings } from '../../domain/piping/types'
import { supabase } from '../supabase'
import { callRpc, isDayKey, requireRows, toError } from './shared'

/** Piping per project: read, enable, change, disable (spec §2, 0038 piping_settings / piping_enable). */

/** What the admin types when enabling, and later in Cấu hình. */
export interface PipingSettingsInput {
  weekStartDate: DayKey
  /** Null: not entered yet; Reinstatement entries are refused until it is (R-4). */
  totalTestPacks: number | null
  lateThresholdDays: number
}

const SETTINGS_SELECT = 'project_id, enabled, week_start_date, total_test_packs, late_threshold_days'

/**
 * The project's settings, or null when Piping was never enabled for it. A
 * disabled project still has its row (`enabled: false`; data is kept).
 */
export async function getPipingSettings(projectId: string): Promise<PipingSettings | null> {
  const { data, error } = await supabase
    .from('piping_settings')
    .select(SETTINGS_SELECT)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw toError(error)
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    projectId: r.project_id as string,
    enabled: r.enabled === true,
    weekStartDate: r.week_start_date as string,
    totalTestPacks: r.total_test_packs === null || r.total_test_packs === undefined ? null : Number(r.total_test_packs),
    lateThresholdDays: Number(r.late_threshold_days),
  }
}

/**
 * The same rules the table's CHECKs and piping_enable hold, in the
 * function's own words, checked first: a constraint message is not something
 * to show, and an `int` column refuses 1.5 in English.
 */
function checkSettings(input: PipingSettingsInput): void {
  if (!isDayKey(input.weekStartDate)) throw new Error('Cần chọn ngày bắt đầu tuần')
  const total = input.totalTestPacks
  if (total !== null && !(Number.isInteger(total) && total >= 0)) {
    throw new Error('Tổng Test Pack phải là số nguyên lớn hơn hoặc bằng 0')
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
