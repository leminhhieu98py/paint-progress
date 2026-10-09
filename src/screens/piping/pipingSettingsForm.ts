import dayjs, { type Dayjs } from 'dayjs'
import type { PipingSettings } from '../../domain/piping/types'
import type { PipingSettingsInput } from '../../lib/pipingApi'

/** The form's own shape: a picker's day, two number fields that may be empty. */
export interface PipingSettingsValues {
  weekStartDate: Dayjs | null
  totalTestPacks: number | null
  lateThresholdDays: number | null
}

/** The late threshold a new project starts with (spec §2). */
export const DEFAULT_LATE_THRESHOLD = 7

/**
 * What the form opens on. A project with stored settings (Cấu hình, or one
 * being re-enabled) shows them; a new one gets no week start date -- the
 * admin picks it (Q7C) -- and the default threshold.
 */
export function settingsValues(settings: PipingSettings | null): PipingSettingsValues {
  if (settings === null) {
    return { weekStartDate: null, totalTestPacks: null, lateThresholdDays: DEFAULT_LATE_THRESHOLD }
  }
  return {
    weekStartDate: dayjs(settings.weekStartDate),
    totalTestPacks: settings.totalTestPacks,
    lateThresholdDays: settings.lateThresholdDays,
  }
}

/** The validated form as the API takes it. */
export function settingsInput(values: PipingSettingsValues): PipingSettingsInput {
  return {
    weekStartDate: (values.weekStartDate as Dayjs).format('YYYY-MM-DD'),
    totalTestPacks: values.totalTestPacks ?? null,
    lateThresholdDays: values.lateThresholdDays as number,
  }
}
