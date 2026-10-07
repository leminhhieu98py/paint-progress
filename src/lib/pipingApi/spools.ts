import type { ActualChange, ActualResolution } from '../../domain/piping/cam'
import type { Milestone, Spool, SpoolMaster, SpoolPlanDates } from '../../domain/piping/types'
import { supabase } from '../supabase'
import { MAX_ROWS, TOO_MANY_ROWS, callRpc, importResult, readAll, type PipingImportResult } from './shared'

/**
 * CAM Insulation spools (spec §6): the read (paged -- a project holds up to
 * 20 000), the admin's Plan import (piping_replace_spools) and the actual
 * dates (piping_set_spool_actuals, for manual entry and the Actual import).
 */

const SPOOL_SELECT =
  'id, seq, spool_no, line_no, insu_type, drawing_no, test_package_no, painting_system, extra,'
  + ' ph_plan, ih_plan, iw_plan, ph_actual, ih_actual, iw_actual,'
  + ' ph_actual_by, ph_actual_at, ih_actual_by, ih_actual_at, iw_actual_by, iw_actual_at'

/** Text values only: the import stores text, and a hand-edited non-text value must not reach the screen as an object. */
function extraOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val
  }
  return out
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function mapSpool(r: Record<string, unknown>): Spool {
  const stamp = (m: Milestone) => ({ by: text(r[`${m}_actual_by`]), at: text(r[`${m}_actual_at`]) })
  return {
    id: r.id as string,
    seq: Number(r.seq),
    spoolNo: r.spool_no as string,
    lineNo: text(r.line_no),
    insuType: text(r.insu_type),
    drawingNo: text(r.drawing_no),
    testPackageNo: text(r.test_package_no),
    paintingSystem: text(r.painting_system),
    extra: extraOf(r.extra),
    phPlan: text(r.ph_plan),
    ihPlan: text(r.ih_plan),
    iwPlan: text(r.iw_plan),
    phActual: text(r.ph_actual),
    ihActual: text(r.ih_actual),
    iwActual: text(r.iw_actual),
    stamps: { ph: stamp('ph'), ih: stamp('ih'), iw: stamp('iw') },
  }
}

/**
 * Every spool of the project in file order. Paged past PostgREST's 1000-row
 * answer, ordered by (seq, id): seq repeats nowhere after an import, and id
 * makes the order total regardless.
 */
export async function listSpools(projectId: string): Promise<Spool[]> {
  const rows = await readAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('piping_spools')
      .select(SPOOL_SELECT)
      .eq('project_id', projectId)
      .order('seq', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  )
  return rows.map(mapSpool)
}

/** One spool row of a Plan file, as `parseSpoolPlan` yields it (its row/seq are not sent: seq = position). */
export type SpoolPlanInput = SpoolMaster & SpoolPlanDates & { extra: Record<string, string> }

/**
 * Replaces the project's spools with `rows`, IN FILE ORDER (seq = position,
 * and duplicates pair old/new by that order, R-10). Matched spools keep their
 * actuals and notes; spools absent from the file are deleted with theirs
 * (Q19A) -- the caller has shown the diff and had it confirmed. Admin only.
 */
export async function replaceSpools(
  projectId: string,
  rows: SpoolPlanInput[],
  fileName: string,
  summary: Record<string, unknown> = {},
): Promise<PipingImportResult> {
  if (rows.length > MAX_ROWS) throw new Error(TOO_MANY_ROWS)
  const data = await callRpc<unknown>('piping_replace_spools', {
    p_project: projectId,
    p_rows: rows.map((r) => ({
      spool_no: r.spoolNo,
      line_no: r.lineNo,
      insu_type: r.insuType,
      drawing_no: r.drawingNo,
      test_package_no: r.testPackageNo,
      painting_system: r.paintingSystem,
      ph_plan: r.phPlan,
      ih_plan: r.ihPlan,
      iw_plan: r.iwPlan,
      extra: r.extra,
    })),
    p_file_name: fileName,
    p_summary: summary,
  })
  return importResult(data)
}

/** How piping_set_spool_actuals judged one spool. */
export type SpoolActualStatus = 'saved' | 'unchanged' | 'not_found' | 'order' | 'overwrite_needed'

export interface SpoolActualResult {
  spoolId: string
  spoolNo: string | null
  status: SpoolActualStatus
}

export interface SetSpoolActualsOptions {
  /** Replace existing, different dates (the confirm-before-overwrite rule). */
  overwrite?: boolean
  /** An Actual import: all or nothing, and logged under this file name. */
  importFile?: string
  /** Classify only: nothing written, no log row ("saved" = would be saved). */
  dryRun?: boolean
  /** The file's own row count, kept in the log summary only (0..20 000). */
  fileRows?: number
}

/** The RPC's limits: 20 000 spools, 60 000 changes (all three columns of a 20 000-row file). */
const MAX_CHANGES = 60_000

/**
 * Sets (or, admin only, clears with null) actual dates. Each (spool,
 * milestone) at most once. Returns one result per distinct spool, by spool
 * id. Manual entry: only 'saved' spools are written, the rest listed. Import
 * (`importFile`): any not_found / order / overwrite_needed raises
 * "Spool S: ... Không có dữ liệu nào được ghi." and nothing is written.
 * Run with `dryRun` first to show the list before the confirm.
 */
export async function setSpoolActuals(
  projectId: string,
  changes: ActualChange[],
  options: SetSpoolActualsOptions = {},
): Promise<SpoolActualResult[]> {
  const { fileRows } = options
  if (
    changes.length > MAX_CHANGES
    || new Set(changes.map((c) => c.spoolId.toLowerCase())).size > MAX_ROWS
    || (fileRows !== undefined && !(Number.isInteger(fileRows) && fileRows >= 0 && fileRows <= MAX_ROWS))
  ) {
    throw new Error(TOO_MANY_ROWS)
  }
  const data = await callRpc<unknown>('piping_set_spool_actuals', {
    p_project: projectId,
    p_changes: changes.map((c) => ({ spool_id: c.spoolId, milestone: c.milestone, date: c.date })),
    p_overwrite: options.overwrite === true,
    p_import_file: options.importFile ?? null,
    p_dry_run: options.dryRun === true,
    p_file_rows: fileRows ?? null,
  })
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    spoolId: r.spool_id as string,
    spoolNo: text(r.spool_no),
    status: r.status as SpoolActualStatus,
  }))
}

/** `resolveActualChanges` / `resolveSpoolActualImport` updates, flattened into the RPC's change list. */
export function flattenActualUpdates(updates: ActualResolution['updates']): ActualChange[] {
  return updates.flatMap((u) => u.changes.map((c) => ({ spoolId: u.spoolId, milestone: c.milestone, date: c.date })))
}
