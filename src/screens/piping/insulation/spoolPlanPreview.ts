import {
  diffSpoolPlan, diffSpoolPlanUpdate, type ImportIssue, type SpoolDiffField, type SpoolFieldChange, type SpoolPlanRow,
} from '../../../domain/piping/imports'
import type { Spool } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import type { PlanDiffLine, PlanImportPreview } from '../PlanImportFlow'
import { formatQty } from '../pipingFormat'

/**
 * The Insulation Plan re-import preview (spec §6.2, R-10, Q19A): old and new
 * spools paired by SpoolNo (`diffSpoolPlan`); a line per added spool, per
 * changed field of a matched spool, per removed spool -- those carrying an
 * actual flagged, and their loss said in a danger tone, since the replace
 * deletes them with their actuals.
 */

const DATE_FIELDS = new Set<SpoolDiffField>(['phPlan', 'ihPlan', 'iwPlan'])

/** A removed spool named in the danger line: ten at most, then how many more. */
const MAX_NAMED = 10

function value(field: SpoolDiffField, v: string | null): string | null {
  if (v === null) return null
  return DATE_FIELDS.has(field) ? formatDayMonthYear(v) : v
}

/** Where a removed spool sat: its line and package, to tell duplicates apart. */
function place(s: Spool): string {
  const parts = [s.lineNo, s.testPackageNo].map((v) => v?.trim() ?? '').filter((v) => v !== '')
  return parts.length === 0 ? MISSING : parts.join(' · ')
}

/** Ten names at most, then how many more. */
function names(list: string[]): string {
  const more = list.length > MAX_NAMED ? ` và ${formatQty(list.length - MAX_NAMED)} spool khác` : ''
  return `${list.slice(0, MAX_NAMED).join(', ')}${more}`
}

/**
 * `noteCounts`: the admin's notes per spool id (spec §9) -- a removed spool's
 * notes are deleted with it, so they are flagged and their loss said too.
 * `null` when they could not be read: any removal is then said as a danger,
 * so it still asks for the typed confirm.
 */
export function spoolPlanPreview(
  stored: Spool[],
  next: SpoolPlanRow[],
  noteCounts: ReadonlyMap<string, number> | null = new Map(),
): PlanImportPreview {
  const diff = diffSpoolPlan(stored, next)
  const notesOf = (s: Spool) => noteCounts?.get(s.id) ?? 0
  const lines: PlanDiffLine[] = [
    ...addedAndChanged(diff.added, diff.changed),
    ...diff.removed.map(({ spool, hasActuals }) => ({
      key: `r|${spool.id}`,
      change: 'removed' as const,
      label: spool.spoolNo,
      from: place(spool),
      to: null,
      ...flagOf(hasActuals, notesOf(spool) > 0),
    })),
  ]
  const lost = diff.removed.filter((r) => r.hasActuals).map((r) => r.spool.spoolNo)
  const noted = diff.removed.filter((r) => notesOf(r.spool) > 0)
  const lostNotes = noted.reduce((sum, r) => sum + notesOf(r.spool), 0)
  const consequences: string[] = []
  if (diff.removed.length > 0) consequences.push(`${formatQty(diff.removed.length)} spool không có trong file bị xoá.`)
  if (diff.matches.length > 0) consequences.push('Spool khớp SpoolNo giữ nguyên ngày Actual.')
  return {
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    unchanged: diff.unchangedCount,
    lines,
    consequences,
    dangers: [
      ...(lost.length === 0 ? [] : [`${formatQty(lost.length)} spool bị xoá cùng ngày Actual đã nhập: ${names(lost)}.`]),
      ...(lostNotes === 0
        ? []
        : [`${formatQty(lostNotes)} ghi chú sẽ bị xoá cùng spool: ${names(noted.map((r) => r.spool.spoolNo))}.`]),
      ...(noteCounts === null && diff.removed.length > 0 ? ['Không đếm được ghi chú của các spool bị xoá.'] : []),
    ],
  }
}

/** A line per added spool and per changed field of a matched one. */
function addedAndChanged(
  added: SpoolPlanRow[], changed: Array<{ spool: Spool; changes: SpoolFieldChange[] }>,
): PlanDiffLine[] {
  return [
    ...added.map((r) => ({
      key: `a|${r.seq}`, change: 'added' as const, label: r.spoolNo, from: null, to: `Dòng ${formatQty(r.row)}`,
    })),
    ...changed.flatMap(({ spool, changes }) => changes.map((c) => ({
      key: `c|${spool.id}|${c.field}|${c.label}`,
      change: 'changed' as const,
      label: `${spool.spoolNo} · ${c.label}`,
      from: value(c.field, c.from),
      to: value(c.field, c.to),
    }))),
  ]
}

/**
 * The Update Plan preview (RV8-5): added spools and changed fields only --
 * nothing is removed, so there is no danger. The warnings are the file's
 * column warnings and the merged result's duplicates and plan-order breaks.
 */
export function spoolPlanUpdatePreview(
  stored: Spool[],
  next: SpoolPlanRow[],
  columnWarnings: ImportIssue[] = [],
): PlanImportPreview {
  const diff = diffSpoolPlanUpdate(stored, next)
  const consequences: string[] = []
  if (diff.kept.length > 0) consequences.push(`${formatQty(diff.kept.length)} spool không có trong file được giữ nguyên cùng ngày Actual.`)
  if (diff.added.length > 0) consequences.push(`${formatQty(diff.added.length)} spool mới được thêm sau các spool hiện có.`)
  if (diff.changed.length + diff.unchangedCount > 0) consequences.push('Spool khớp SpoolNo giữ nguyên ngày Actual.')
  return {
    added: diff.added.length,
    changed: diff.changed.length,
    unchanged: diff.unchangedCount,
    lines: addedAndChanged(diff.added, diff.changed),
    consequences,
    warnings: [...columnWarnings, ...diff.warnings],
  }
}

function flagOf(hasActuals: boolean, hasNotes: boolean): { flag?: string } {
  const flags = [hasActuals && 'có Actual', hasNotes && 'có ghi chú'].filter((f): f is string => Boolean(f))
  return flags.length === 0 ? {} : { flag: flags.join(', ') }
}

/** The diff's counts, kept in the import log's summary. */
export function spoolPlanSummary(stored: Spool[], next: SpoolPlanRow[]): Record<string, number> {
  const diff = diffSpoolPlan(stored, next)
  return {
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    removedWithActuals: diff.removed.filter((r) => r.hasActuals).length,
  }
}

/** The Update Plan preview's counts, kept in the import log's summary. */
export function spoolPlanUpdateSummary(stored: Spool[], next: SpoolPlanRow[]): Record<string, number> {
  const diff = diffSpoolPlanUpdate(stored, next)
  return { added: diff.added.length, changed: diff.changed.length }
}
