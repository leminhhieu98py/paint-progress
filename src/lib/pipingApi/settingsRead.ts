import type { PipingSettings } from '../../domain/piping/types'
import { supabase } from '../supabase'
import { toError } from './shared'

/**
 * The settings read (spec §2), apart from the admin's writers in `settings.ts`:
 * the field header asks it on every field page, so its chunk carries this and
 * nothing else of the Piping API.
 */

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
