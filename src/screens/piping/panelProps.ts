import type { DayKey, PipingSettings, ViewMode } from '../../domain/piping/types'

/** Who is looking: the admin, a foreman of the project, or a viewer (spec §1). */
export type PipingRole = 'admin' | 'gs' | 'viewer'

/**
 * What the Piping page hands each tab panel (Reinstatement, Manpower,
 * Insulation) and the export action. The page owns the project, its settings,
 * the Ngày | Tuần view and today; a panel owns its own reads and writes.
 */
export interface PipingPanelProps {
  projectId: string
  /** The project's settings; always enabled here (the page shows no panel otherwise). */
  settings: PipingSettings
  /** The page-level Ngày | Tuần toggle (spec §3). */
  mode: ViewMode
  /** Admin frame or field shell. */
  variant: 'admin' | 'gs'
  /** What the viewer may do: admin edits and imports, gs enters actuals, viewer reads (spec §1). */
  role: PipingRole
  /** Today in Vietnam (`effortDayKey`), read once by the page so every panel agrees on it. */
  todayKey: DayKey
  /**
   * Goes up whenever Cấu hình changed something a panel reads (settings,
   * manpower groups, extra spool columns): a panel re-reads when it changes.
   */
  refreshKey: number
}
