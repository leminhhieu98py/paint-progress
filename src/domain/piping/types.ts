/**
 * Piping module -- domain types (spec 2026-10-07-piping.md §2-§9).
 *
 * camelCase and independent of the database column names: the API layer
 * (`lib/pipingApi.ts`) maps rows into these, so a renamed column never reaches
 * a pure function. Every calendar day is a `YYYY-MM-DD` day key in Vietnam
 * time (`effortDayKey`), never a Date: weeks are computed at display time and
 * a Date would drag a time zone into arithmetic that has none.
 */

/** A calendar day, `YYYY-MM-DD`. */
export type DayKey = string

/** The page-level Ngày | Tuần toggle (spec §3). */
export type ViewMode = 'day' | 'week'

/** Per-project settings (spec §2). */
export interface PipingSettings {
  projectId: string
  enabled: boolean
  /** Week 0 starts on this day; week k is [start + 7k, start + 7k + 6]. */
  weekStartDate: DayKey
  /** Total Test Pack, the Reinstatement cap. Null = not set yet (R-4). */
  totalTestPacks: number | null
  /** N in the late rule (spec §7), 0..365, default 7. */
  lateThresholdDays: number
}

/** One day of the Reinstatement plan (spec §4). One row per day. */
export interface ReinstatementPlanRow {
  day: DayKey
  planQty: number
}

/** One append-only Reinstatement entry; entries on one day add up (R-3). */
export interface ReinstatementActualEntry {
  id: string
  day: DayKey
  qty: number
  createdBy: string | null
  createdAt: string | null
  editedBy: string | null
  editedAt: string | null
}

/** A Manpower group (spec §5). Hidden groups keep their history (R-8). */
export interface ManpowerGroup {
  id: string
  name: string
  sort: number
  hidden: boolean
}

/** One Manpower cell, plan or actual: a group's value on a day. */
export interface ManpowerValue {
  groupId: string
  day: DayKey
  value: number
}

/** A Manpower actual cell with its stamps. */
export interface ManpowerActualValue extends ManpowerValue {
  createdBy: string | null
  createdAt: string | null
  editedBy: string | null
  editedAt: string | null
}

/**
 * The three CAM milestones (spec §6.1):
 * PH = Painting Handover, IH = Insulation Handover, IW = Insulation Work.
 */
export type Milestone = 'ph' | 'ih' | 'iw'

/** The department responsible for a milestone (spec §7). */
export type Department = 'Piping' | 'Painting' | 'Insulation'

/** The six master text fields of a spool, as the file names them. */
export interface SpoolMaster {
  spoolNo: string
  lineNo: string | null
  insuType: string | null
  drawingNo: string | null
  testPackageNo: string | null
  paintingSystem: string | null
}

/** The three plan dates of a spool. */
export interface SpoolPlanDates {
  phPlan: DayKey | null
  ihPlan: DayKey | null
  iwPlan: DayKey | null
}

/** The three actual dates of a spool. */
export interface SpoolActualDates {
  phActual: DayKey | null
  ihActual: DayKey | null
  iwActual: DayKey | null
}

/** Who last wrote a milestone's actual date, and when. */
export interface ActualStamp {
  by: string | null
  at: string | null
}

/**
 * One spool row (spec §6.1). SpoolNo may repeat within a project (Q14C), so
 * `id` is the identity and `seq` the file order.
 */
export interface Spool extends SpoolMaster, SpoolPlanDates, SpoolActualDates {
  id: string
  seq: number
  /** Values of the admin-defined extra columns, keyed by column label. */
  extra: Record<string, string>
  stamps?: Partial<Record<Milestone, ActualStamp>>
}

/** An admin-defined extra text column on spools (spec §6.1, Q21A). */
export interface SpoolColumn {
  id: string
  label: string
  sort: number
}

/**
 * The CAM counting unit (spec §6.4). `spoolNo` counts spool ROWS; every other
 * unit counts distinct non-blank values.
 */
export type Unit = 'spoolNo' | 'lineNo' | 'insuType' | 'drawingNo' | 'testPackageNo' | 'paintingSystem'

/** The detail table's level selector (spec §6.4, Q16B). */
export type CamLevel = 'package' | 'line' | 'spool'

/** The Insulation chart's Plan | Actual | Plan & Actual toggle (Q20A). */
export type CamSelection = 'plan' | 'actual' | 'both'

/** What an admin note hangs on (spec §9). */
export type NoteTarget = 'reinstatement_day' | 'manpower_day' | 'spool'

/** An admin-only note (spec §9). */
export interface PipingNote {
  id: string
  target: NoteTarget
  day: DayKey | null
  spoolId: string | null
  body: string
  authorId: string | null
  createdAt: string | null
  updatedBy: string | null
  updatedAt: string | null
}

/** The four imports (spec §8). */
export type ImportKind = 'reinstatement_plan' | 'manpower_plan' | 'spool_plan' | 'spool_actual'

/** One confirmed import, as listed in Cấu hình (spec §8). */
export interface PipingImportLogEntry {
  id: string
  kind: ImportKind
  fileName: string
  rowCount: number
  summary: Record<string, unknown>
  importedBy: string | null
  importedAt: string | null
}
