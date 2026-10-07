import { parseViDecimal } from '../../components/viNumberInput'
import { MILESTONES, actualDates, duplicateSpoolGroups, orderMessage, planOrderIssues,
  resolveActualChanges, spoolKey, type ActualChange, type ActualOverwrite, type ActualResolution } from './cam'
import type {
  DayKey,
  ManpowerGroup,
  ManpowerValue,
  Milestone,
  ReinstatementPlanRow,
  Spool,
  SpoolColumn,
  SpoolMaster,
  SpoolPlanDates,
} from './types'

/**
 * Piping imports -- spec §8 (common rules), §6.2 (Insulation Plan), §6.3
 * (Insulation Actual), R-9, R-10, R-11, R-14.
 *
 * Pure: `lib/piping/xlsx.ts` turns the file into cell values, this module
 * finds the header, parses and validates every row, and diffs against what is
 * stored. Nothing here writes.
 *
 * No half import: whenever `errors` is non-empty, `rows` (and every change
 * list) is EMPTY, so a caller cannot send part of a file by mistake. Errors and
 * warnings carry the SHEET row number (1-based, as Excel shows it), or null for
 * the file as a whole. Warnings never block.
 */

/** A cell as `lib/piping/xlsx.ts` hands it over: formulas resolved to their result. */
export type CellValue = string | number | boolean | Date | null

/** A sheet's rows; `rows[i]` is sheet row `i + 1`, `rows[i][j]` column `j + 1`. */
export interface SheetRows {
  name: string
  rows: CellValue[][]
}

export interface ImportIssue {
  /** The sheet row (1-based); null for the file as a whole. */
  row: number | null
  message: string
}

export interface ParseResult<T> {
  /** The sheet read; null when no sheet had the header. */
  sheetName: string | null
  /** Empty whenever `errors` is not. */
  rows: T[]
  /** Non-blank data rows in the file. */
  rowCount: number
  errors: ImportIssue[]
  warnings: ImportIssue[]
}

/** Spec §8 limits. */
export const MAX_IMPORT_ROWS = 20_000
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
/** How far down each sheet the header row is looked for (a title may sit above it). */
export const HEADER_SCAN_ROWS = 20

/** A column the importer knows: its label (the template header) and aliases. */
export interface ColumnSpec {
  label: string
  aliases: readonly string[]
}

export const DATE_COLUMN: ColumnSpec = { label: 'Date', aliases: ['Ngày', 'Day'] }
export const PLAN_QTY_COLUMN: ColumnSpec = { label: 'Plan Qty', aliases: ['Plan', 'Kế hoạch', 'Plan Quantity'] }

/** The six master columns, as the customer's file names them (spec §0). */
export const SPOOL_MASTER_COLUMNS: Record<keyof SpoolMaster, ColumnSpec> = {
  spoolNo: { label: 'SpoolNo', aliases: ['SpoolsNo', 'Spool No', 'Spool'] },
  lineNo: { label: 'LineNo', aliases: ['Line No', 'Line'] },
  insuType: { label: 'InsuType', aliases: ['Insu Type', 'Insulation Type'] },
  drawingNo: { label: 'DrawingNo', aliases: ['Drawing No', 'Drawing'] },
  testPackageNo: { label: 'Test Package No', aliases: ['TestPackageNo', 'Test Pack No', 'Test Package', 'Test Pack'] },
  paintingSystem: { label: 'Painting System', aliases: ['PaintingSystem'] },
}

const MASTER_KEYS = Object.keys(SPOOL_MASTER_COLUMNS) as Array<keyof SpoolMaster>

export const SPOOL_PLAN_COLUMNS: Record<Milestone, ColumnSpec> = {
  ph: { label: 'Painting Handover – Plan', aliases: ['PH Plan'] },
  ih: { label: 'Insulation Handover – Plan', aliases: ['IH Plan'] },
  iw: { label: 'Insulation Work – Plan', aliases: ['IW Plan'] },
}

export const SPOOL_ACTUAL_COLUMNS: Record<Milestone, ColumnSpec> = {
  ph: { label: 'Painting Handover – Actual', aliases: ['PH Actual'] },
  ih: { label: 'Insulation Handover – Actual', aliases: ['IH Actual'] },
  iw: { label: 'Insulation Work – Actual', aliases: ['IW Actual'] },
}

const PLAN_FIELD: Record<Milestone, keyof SpoolPlanDates> = { ph: 'phPlan', ih: 'ihPlan', iw: 'iwPlan' }

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * A header as compared: case, whitespace (non-breaking included), every dash
 * (-, –, —, …), underscores and dots ignored. "Painting Handover – Plan" and
 * "painting handover - plan" are the same header.
 */
export function normalizeHeader(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[\s‐-―_.-]+/g, '')
}

function namesOf(spec: ColumnSpec): string[] {
  return [spec.label, ...spec.aliases].map(normalizeHeader)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
/** Excel's day 0 in the 1900 system, as the serials of today's dates count from it. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
/** Serials for 2000-01-01 .. 2100-12-31: a bare number outside is not a date. */
const SERIAL_MIN = 36526
const SERIAL_MAX = 73415

/**
 * ExcelJS hands a date cell over as the wall-clock date at UTC. One second of
 * slack before midnight absorbs a serial stored a hair under the whole day.
 */
function dateToDay(d: Date): DayKey {
  const days = Math.floor((d.getTime() + 1000) / MS_PER_DAY)
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10)
}

function dayDisplay(day: DayKey): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`
}

/** A cell as text in a message. */
function cellDisplay(v: CellValue): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : dayDisplay(dateToDay(v))
  return String(v ?? '').trim()
}

/** A text cell: trimmed, blank as null; a number or date as its text. */
export function textCell(v: CellValue): string | null {
  if (v === null) return null
  const s = v instanceof Date ? (Number.isNaN(v.getTime()) ? '' : dateToDay(v)) : String(v).trim()
  return s === '' ? null : s
}

function validDay(y: number, m: number, d: number): DayKey | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > last) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A date cell (spec §8): an Excel date, a `dd/mm/yyyy` (also `d/m/yyyy`, with
 * `-` or `.`) or `yyyy-mm-dd` text, or a bare Excel serial (a date cell whose
 * format was lost). Blank is null. Years 2000-2100 only, which catches the
 * mm/dd and two-digit-year slips a construction plan would otherwise accept.
 */
export function parseDayCell(v: CellValue): { day: DayKey } | { error: string } | null {
  if (v === null) return null
  const bad = { error: `Ngày không hợp lệ: "${cellDisplay(v)}"` }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? bad : { day: dateToDay(v) }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < SERIAL_MIN || v >= SERIAL_MAX + 1) return bad
    return { day: dateToDay(new Date(EXCEL_EPOCH_MS + Math.floor(v) * MS_PER_DAY)) }
  }
  if (typeof v !== 'string') return bad
  const s = v.trim()
  if (s === '') return null
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) {
    const day = validDay(Number(m[3]), Number(m[2]), Number(m[1]))
    return day ? { day } : bad
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) {
    const day = validDay(Number(m[1]), Number(m[2]), Number(m[3]))
    return day ? { day } : bad
  }
  return bad
}

/**
 * A number cell: a number, or text read the way `parseViDecimal` reads a typed
 * number ("2,5", "1.230,5", "1,230.5", "2.5"). Blank is null. The sign is the
 * caller's to check.
 */
export function parseNumberCell(v: CellValue): { value: number } | { error: string } | null {
  if (v === null) return null
  const bad = { error: `Không phải số: "${cellDisplay(v)}"` }
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : bad
  if (typeof v !== 'string') return bad
  if (v.trim() === '') return null
  const normalised = parseViDecimal(v)
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return bad
  return { value: Number(normalised) }
}

// ---------------------------------------------------------------------------
// Header and rows
// ---------------------------------------------------------------------------

interface Header {
  sheet: SheetRows
  /** 0-based index of the header row in `sheet.rows`. */
  index: number
  /** The header text of each column, trimmed ('' for blank). */
  texts: string[]
  /** The same, normalised. */
  norm: string[]
}

/** The first header row, across sheets in order, that `accept` takes. */
function findHeader(sheets: SheetRows[], accept: (norm: string[]) => boolean): Header | null {
  for (const sheet of sheets) {
    const scan = Math.min(HEADER_SCAN_ROWS, sheet.rows.length)
    for (let index = 0; index < scan; index += 1) {
      const texts = (sheet.rows[index] ?? []).map((c) => textCell(c) ?? '')
      const norm = texts.map(normalizeHeader)
      if (accept(norm)) return { sheet, index, texts, norm }
    }
  }
  return null
}

function columnOf(norm: string[], spec: ColumnSpec): number {
  const names = namesOf(spec)
  return norm.findIndex((h) => h !== '' && names.includes(h))
}

const hasAll = (specs: ColumnSpec[]) => (norm: string[]) => specs.every((s) => columnOf(norm, s) !== -1)

function missingHeader(labels: string): ImportIssue {
  return { row: null, message: `Không tìm thấy dòng tiêu đề có các cột: ${labels}` }
}

/** The data rows under the header that have anything in `columns`, with their sheet row numbers. */
function dataRows(header: Header, columns: number[]): Array<{ row: number; cells: CellValue[] }> {
  const out: Array<{ row: number; cells: CellValue[] }> = []
  const rows = header.sheet.rows
  for (let i = header.index + 1; i < rows.length; i += 1) {
    const cells = rows[i] ?? []
    if (columns.every((c) => textCell(cells[c] ?? null) === null)) continue
    out.push({ row: i + 1, cells })
  }
  return out
}

function cellAt(cells: CellValue[], column: number): CellValue {
  return column < 0 ? null : (cells[column] ?? null)
}

function empty<T>(sheetName: string | null, errors: ImportIssue[], warnings: ImportIssue[] = [], rowCount = 0): ParseResult<T> {
  return { sheetName, rows: [], rowCount, errors, warnings }
}

function finish<T>(sheetName: string, rows: T[], rowCount: number, errors: ImportIssue[], warnings: ImportIssue[]): ParseResult<T> {
  return { sheetName, rows: errors.length > 0 ? [] : rows, rowCount, errors, warnings }
}

function checkPreamble(sheets: SheetRows[]): ImportIssue | null {
  return sheets.length === 0 ? { row: null, message: 'File không có sheet nào' } : null
}

function tooMany(count: number): ImportIssue {
  return { row: null, message: `File có ${count} dòng, tối đa ${MAX_IMPORT_ROWS}` }
}

/** One date per row, repeated dates refused (spec §8). */
function readDate(
  cells: CellValue[],
  column: number,
  row: number,
  seen: Map<DayKey, number>,
  errors: ImportIssue[],
): DayKey | null {
  const parsed = parseDayCell(cellAt(cells, column))
  if (parsed === null) {
    errors.push({ row, message: `Thiếu ${DATE_COLUMN.label}` })
    return null
  }
  if ('error' in parsed) {
    errors.push({ row, message: parsed.error })
    return null
  }
  const first = seen.get(parsed.day)
  if (first !== undefined) {
    errors.push({ row, message: `Ngày ${dayDisplay(parsed.day)} trùng với dòng ${first}` })
    return null
  }
  seen.set(parsed.day, row)
  return parsed.day
}

/** A number >= 0 under `label`; null when blank (and pushes nothing). */
function readAmount(v: CellValue, label: string, row: number, errors: ImportIssue[]): number | null | undefined {
  const parsed = parseNumberCell(v)
  if (parsed === null) return null
  if ('error' in parsed) {
    errors.push({ row, message: `${label}: ${parsed.error}` })
    return undefined
  }
  if (parsed.value < 0) {
    errors.push({ row, message: `${label} phải ≥ 0` })
    return undefined
  }
  return parsed.value
}

// ---------------------------------------------------------------------------
// Reinstatement Plan
// ---------------------------------------------------------------------------

/** A `Date` + `Plan Qty` file (spec §8): one row per day, daily or weekly. */
export function parseReinstatementPlan(sheets: SheetRows[]): ParseResult<ReinstatementPlanRow> {
  const pre = checkPreamble(sheets)
  if (pre) return empty(null, [pre])
  const header = findHeader(sheets, hasAll([DATE_COLUMN, PLAN_QTY_COLUMN]))
  if (!header) return empty(null, [missingHeader(`${DATE_COLUMN.label}, ${PLAN_QTY_COLUMN.label}`)])
  const dateCol = columnOf(header.norm, DATE_COLUMN)
  const qtyCol = columnOf(header.norm, PLAN_QTY_COLUMN)
  const data = dataRows(header, [dateCol, qtyCol])
  if (data.length > MAX_IMPORT_ROWS) return empty(header.sheet.name, [tooMany(data.length)], [], data.length)

  const errors: ImportIssue[] = []
  const rows: ReinstatementPlanRow[] = []
  const seen = new Map<DayKey, number>()
  for (const { row, cells } of data) {
    const day = readDate(cells, dateCol, row, seen, errors)
    const qty = readAmount(cellAt(cells, qtyCol), PLAN_QTY_COLUMN.label, row, errors)
    if (qty === null) errors.push({ row, message: `Thiếu ${PLAN_QTY_COLUMN.label}` })
    if (day !== null && typeof qty === 'number') rows.push({ day, planQty: qty })
  }
  return finish(header.sheet.name, rows, data.length, errors, [])
}

// ---------------------------------------------------------------------------
// Manpower Plan
// ---------------------------------------------------------------------------

/**
 * A `Date` + one-column-per-group file (spec §8). Every other non-blank header
 * must name a configured group, hidden ones included; an unknown one is an
 * error that lists it, so the admin creates the group first (R-14). A blank
 * cell is no plan for that group on that day.
 */
export function parseManpowerPlan(sheets: SheetRows[], groups: ManpowerGroup[]): ParseResult<ManpowerValue> {
  const pre = checkPreamble(sheets)
  if (pre) return empty(null, [pre])
  const byName = new Map(groups.map((g) => [normalizeHeader(g.name), g]))
  // A workbook may carry other sheets with a date column (the customer's own
  // has three): the one naming a group wins, else the first with a date.
  const header = findHeader(sheets, (norm) => columnOf(norm, DATE_COLUMN) !== -1 && norm.some((h) => byName.has(h)))
    ?? findHeader(sheets, hasAll([DATE_COLUMN]))
  if (!header) return empty(null, [missingHeader(DATE_COLUMN.label)])
  const dateCol = columnOf(header.norm, DATE_COLUMN)
  const headerRow = header.index + 1
  const columns: Array<{ col: number; group: ManpowerGroup }> = []
  const unknown: string[] = []
  const errors: ImportIssue[] = []
  header.norm.forEach((h, col) => {
    if (col === dateCol || h === '') return
    const group = byName.get(h)
    if (!group) {
      unknown.push(header.texts[col])
      return
    }
    if (columns.some((c) => c.group.id === group.id)) {
      errors.push({ row: headerRow, message: `Cột nhóm ${group.name} lặp lại` })
      return
    }
    columns.push({ col, group })
  })
  if (unknown.length > 0) {
    errors.unshift({ row: headerRow, message: `Nhóm chưa có trong Cấu hình: ${unknown.join(', ')} (tạo nhóm trước khi nhập)` })
  }
  if (errors.length === 0 && columns.length === 0) errors.push({ row: headerRow, message: 'Không có cột nhóm nào' })
  if (errors.length > 0) return empty(header.sheet.name, errors)

  const data = dataRows(header, [dateCol, ...columns.map((c) => c.col)])
  if (data.length > MAX_IMPORT_ROWS) return empty(header.sheet.name, [tooMany(data.length)], [], data.length)
  const warnings: ImportIssue[] = []
  const rows: ManpowerValue[] = []
  const seen = new Map<DayKey, number>()
  for (const { row, cells } of data) {
    const day = readDate(cells, dateCol, row, seen, errors)
    let any = false
    for (const { col, group } of columns) {
      const value = readAmount(cellAt(cells, col), group.name, row, errors)
      if (value === null) continue
      any = true
      if (day !== null && value !== undefined) rows.push({ groupId: group.id, day, value })
    }
    if (day !== null && !any) warnings.push({ row, message: 'Không có giá trị nào, bỏ qua' })
  }
  return finish(header.sheet.name, rows, data.length, errors, warnings)
}

// ---------------------------------------------------------------------------
// Insulation Plan
// ---------------------------------------------------------------------------

/** One parsed spool row of an Insulation Plan file. */
export interface SpoolPlanRow extends SpoolMaster, SpoolPlanDates {
  /** The sheet row, for messages. */
  row: number
  /** File order, 1-based: becomes `piping_spools.seq`. */
  seq: number
  /** Extra column values by configured label; blank cells omitted. */
  extra: Record<string, string>
}

export interface SpoolPlanParse extends ParseResult<SpoolPlanRow> {
  /** SpoolNo occurring more than once (Q14C): imported, listed for review. */
  duplicates: Array<{ spoolNo: string; rows: SpoolPlanRow[] }>
  /** Rows breaking PH <= IH <= IW (Q15B): imported, flagged. */
  planOrder: Array<{ row: SpoolPlanRow; pairs: Array<[Milestone, Milestone]> }>
}

/**
 * An Insulation Plan file (spec §6.2): SpoolNo and the three Plan columns are
 * required; the other master columns are read when present (a warning names
 * the missing ones); a header equal to a configured extra column fills
 * `extra`; Actual columns are ignored without a word (R-9), so the same
 * workbook serves the Actual import; any other header is ignored with a
 * warning. Duplicates and plan-order breaks are warnings, never errors.
 */
export function parseSpoolPlan(sheets: SheetRows[], extraColumns: Array<Pick<SpoolColumn, 'label'>>): SpoolPlanParse {
  const blank = { duplicates: [], planOrder: [] }
  const pre = checkPreamble(sheets)
  if (pre) return { ...empty(null, [pre]), ...blank }
  const required = [SPOOL_MASTER_COLUMNS.spoolNo, ...MILESTONES.map((m) => SPOOL_PLAN_COLUMNS[m])]
  const header = findHeader(sheets, hasAll(required))
  if (!header) return { ...empty(null, [missingHeader(required.map((s) => s.label).join(', '))]), ...blank }
  const headerRow = header.index + 1
  const warnings: ImportIssue[] = []

  const masterCol = Object.fromEntries(MASTER_KEYS.map((k) => [k, columnOf(header.norm, SPOOL_MASTER_COLUMNS[k])])) as Record<keyof SpoolMaster, number>
  const planCol = Object.fromEntries(MILESTONES.map((m) => [m, columnOf(header.norm, SPOOL_PLAN_COLUMNS[m])])) as Record<Milestone, number>
  const used = new Set<number>([...Object.values(masterCol), ...Object.values(planCol)].filter((c) => c !== -1))
  for (const m of MILESTONES) {
    const c = columnOf(header.norm, SPOOL_ACTUAL_COLUMNS[m])
    if (c !== -1) used.add(c)
  }
  const extraCol: Array<{ col: number; label: string }> = []
  for (const { label } of extraColumns) {
    const names = [normalizeHeader(label)]
    const col = header.norm.findIndex((h, i) => h !== '' && !used.has(i) && names.includes(h))
    if (col !== -1) {
      extraCol.push({ col, label })
      used.add(col)
    }
  }
  const missing = MASTER_KEYS.filter((k) => masterCol[k] === -1).map((k) => SPOOL_MASTER_COLUMNS[k].label)
  if (missing.length > 0) warnings.push({ row: headerRow, message: `Không có cột: ${missing.join(', ')}` })
  const ignored = header.texts.filter((t, i) => t !== '' && !used.has(i))
  if (ignored.length > 0) warnings.push({ row: headerRow, message: `Bỏ qua cột: ${ignored.join(', ')}` })

  const read = [...Object.values(masterCol), ...Object.values(planCol), ...extraCol.map((e) => e.col)].filter((c) => c !== -1)
  const data = dataRows(header, read)
  if (data.length > MAX_IMPORT_ROWS) return { ...empty(header.sheet.name, [tooMany(data.length)], warnings, data.length), ...blank }

  const errors: ImportIssue[] = []
  const rows: SpoolPlanRow[] = []
  for (const { row, cells } of data) {
    const spoolNo = textCell(cellAt(cells, masterCol.spoolNo))
    let ok = true
    if (spoolNo === null) {
      errors.push({ row, message: `Thiếu ${SPOOL_MASTER_COLUMNS.spoolNo.label}` })
      ok = false
    }
    const plan: SpoolPlanDates = { phPlan: null, ihPlan: null, iwPlan: null }
    for (const m of MILESTONES) {
      const parsed = parseDayCell(cellAt(cells, planCol[m]))
      if (parsed === null) continue
      if ('error' in parsed) {
        errors.push({ row, message: `${SPOOL_PLAN_COLUMNS[m].label}: ${parsed.error}` })
        ok = false
      } else {
        plan[PLAN_FIELD[m]] = parsed.day
      }
    }
    if (!ok) continue
    const extra: Record<string, string> = {}
    for (const { col, label } of extraCol) {
      const v = textCell(cellAt(cells, col))
      if (v !== null) extra[label] = v
    }
    rows.push({
      row,
      seq: rows.length + 1,
      spoolNo: spoolNo!,
      lineNo: textCell(cellAt(cells, masterCol.lineNo)),
      insuType: textCell(cellAt(cells, masterCol.insuType)),
      drawingNo: textCell(cellAt(cells, masterCol.drawingNo)),
      testPackageNo: textCell(cellAt(cells, masterCol.testPackageNo)),
      paintingSystem: textCell(cellAt(cells, masterCol.paintingSystem)),
      extra,
      ...plan,
    })
  }
  if (errors.length > 0) return { ...empty(header.sheet.name, errors, warnings, data.length), ...blank }

  const planOrder = planOrderIssues(rows)
  const duplicates = duplicateSpoolGroups(rows)
  for (const issue of planOrder) {
    warnings.push({ row: issue.row.row, message: orderMessage(planDatesOf(issue.row), issue.pairs) })
  }
  for (const d of duplicates) {
    warnings.push({ row: null, message: `SpoolNo "${d.spoolNo}" lặp lại ở các dòng ${d.rows.map((r) => r.row).join(', ')}` })
  }
  return { ...finish(header.sheet.name, rows, data.length, errors, warnings), duplicates, planOrder }
}

function planDatesOf(r: SpoolPlanDates): Record<Milestone, DayKey | null> {
  return { ph: r.phPlan, ih: r.ihPlan, iw: r.iwPlan }
}

// ---------------------------------------------------------------------------
// Insulation Actual
// ---------------------------------------------------------------------------

/** One SpoolNo of an Insulation Actual file, its rows merged. */
export interface SpoolActualRow {
  /** The first sheet row with this SpoolNo. */
  row: number
  spoolNo: string
  /** Only the milestones the file gives a date for; a blank cell changes nothing. */
  dates: Partial<Record<Milestone, DayKey>>
}

/**
 * An Insulation Actual file (spec §6.3): SpoolNo and at least one Actual
 * column; Plan and other columns are ignored. A blank Actual cell changes
 * nothing (clearing is admin-only, on screen, R-12); a row without any Actual
 * date is skipped. A SpoolNo repeated in the file is merged when its dates
 * agree and refused when they differ: R-11 applies one SpoolNo to every
 * matching spool, so two different dates for it cannot both be right.
 */
export function parseSpoolActual(sheets: SheetRows[]): ParseResult<SpoolActualRow> {
  const pre = checkPreamble(sheets)
  if (pre) return empty(null, [pre])
  const spoolSpec = SPOOL_MASTER_COLUMNS.spoolNo
  const header = findHeader(sheets, (norm) => columnOf(norm, spoolSpec) !== -1
    && MILESTONES.some((m) => columnOf(norm, SPOOL_ACTUAL_COLUMNS[m]) !== -1))
  if (!header) return empty(null, [missingHeader(`${spoolSpec.label} và ít nhất một cột Actual`)])
  const spoolCol = columnOf(header.norm, spoolSpec)
  const actualCol = Object.fromEntries(MILESTONES.map((m) => [m, columnOf(header.norm, SPOOL_ACTUAL_COLUMNS[m])])) as Record<Milestone, number>
  const present = MILESTONES.filter((m) => actualCol[m] !== -1)
  const data = dataRows(header, [spoolCol, ...present.map((m) => actualCol[m])])
  if (data.length > MAX_IMPORT_ROWS) return empty(header.sheet.name, [tooMany(data.length)], [], data.length)

  const errors: ImportIssue[] = []
  const merged = new Map<string, { entry: SpoolActualRow; rowOf: Partial<Record<Milestone, number>> }>()
  for (const { row, cells } of data) {
    const spoolNo = textCell(cellAt(cells, spoolCol))
    const dates: Partial<Record<Milestone, DayKey>> = {}
    let ok = true
    for (const m of present) {
      const parsed = parseDayCell(cellAt(cells, actualCol[m]))
      if (parsed === null) continue
      if ('error' in parsed) {
        errors.push({ row, message: `${SPOOL_ACTUAL_COLUMNS[m].label}: ${parsed.error}` })
        ok = false
      } else {
        dates[m] = parsed.day
      }
    }
    if (spoolNo === null) {
      errors.push({ row, message: `Thiếu ${spoolSpec.label}` })
      continue
    }
    if (!ok || Object.keys(dates).length === 0) continue
    const key = spoolKey(spoolNo)
    const have = merged.get(key)
    if (!have) {
      merged.set(key, { entry: { row, spoolNo: key, dates }, rowOf: Object.fromEntries(present.map((m) => [m, row])) })
      continue
    }
    for (const m of present) {
      const d = dates[m]
      if (d === undefined) continue
      const before = have.entry.dates[m]
      if (before === undefined) {
        have.entry.dates[m] = d
        have.rowOf[m] = row
      } else if (before !== d) {
        errors.push({ row, message: `SpoolNo "${key}": ${SPOOL_ACTUAL_COLUMNS[m].label} khác với dòng ${have.rowOf[m]}` })
      }
    }
  }
  return finish(header.sheet.name, [...merged.values()].map((v) => v.entry), data.length, errors, [])
}

export interface SpoolActualImport {
  errors: ImportIssue[]
  warnings: ImportIssue[]
  /** Every change to send, one per matching spool and milestone. Empty on any error. */
  changes: ActualChange[]
  /** The same, grouped per spool with no-op dates dropped (what the RPC receives). */
  updates: ActualResolution['updates']
  /** Existing dates the import replaces, old -> new: confirm first. */
  overwrites: Array<ActualOverwrite & { row: number }>
  /** Dates equal to what is stored. */
  unchangedCount: number
}

/**
 * Resolves parsed Actual rows against the project's spools (spec §6.3): an
 * unknown SpoolNo, a date after today, or an order break (existing dates
 * included, Q18A) is a row error and nothing is written. A SpoolNo matching
 * several spools applies to all of them and a warning says so (R-11).
 */
export function resolveSpoolActualImport(rows: SpoolActualRow[], spools: Spool[], todayKey: DayKey): SpoolActualImport {
  const byKey = new Map<string, Spool[]>()
  for (const s of [...spools].sort((a, b) => a.seq - b.seq)) {
    const key = spoolKey(s.spoolNo)
    const list = byKey.get(key)
    if (list) list.push(s)
    else byKey.set(key, [s])
  }
  const errors: ImportIssue[] = []
  const warnings: ImportIssue[] = []
  const changes: ActualChange[] = []
  const rowOfSpool = new Map<string, number>()
  for (const r of rows) {
    const key = spoolKey(r.spoolNo)
    const matches = byKey.get(key) ?? []
    if (matches.length === 0) {
      errors.push({ row: r.row, message: `Không tìm thấy SpoolNo "${key}"` })
      continue
    }
    const future = MILESTONES.find((m) => r.dates[m] !== undefined && r.dates[m]! > todayKey)
    if (future) {
      errors.push({ row: r.row, message: `${SPOOL_ACTUAL_COLUMNS[future].label}: ngày ${dayDisplay(r.dates[future]!)} sau hôm nay` })
      continue
    }
    if (matches.length > 1) warnings.push({ row: r.row, message: `SpoolNo "${key}" khớp ${matches.length} spool, áp dụng cho tất cả` })
    for (const s of matches) {
      if (!rowOfSpool.has(s.id)) rowOfSpool.set(s.id, r.row)
      for (const m of MILESTONES) {
        const d = r.dates[m]
        if (d !== undefined) changes.push({ spoolId: s.id, milestone: m, date: d })
      }
    }
  }
  const resolved = resolveActualChanges(spools, changes, todayKey)
  const reported = new Set<string>()
  for (const rej of resolved.rejected) {
    const row = rowOfSpool.get(rej.spoolId) ?? null
    const message = `SpoolNo "${rej.spoolNo}": ${rej.message}`
    const tag = `${row}|${message}`
    if (reported.has(tag)) continue
    reported.add(tag)
    errors.push({ row, message })
  }
  errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0))
  if (errors.length > 0) return { errors, warnings, changes: [], updates: [], overwrites: [], unchangedCount: 0 }
  return {
    errors,
    warnings,
    changes,
    updates: resolved.updates,
    overwrites: resolved.overwrites.map((o) => ({ row: rowOfSpool.get(o.spoolId)!, ...o })),
    unchangedCount: resolved.unchanged.length,
  }
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

export interface KeyedDiff<K> {
  added: Array<K & { to: number }>
  changed: Array<K & { from: number; to: number }>
  removed: Array<K & { from: number }>
  unchangedCount: number
}

function diffKeyed<K extends object>(
  old: Array<{ key: string; id: K; value: number }>,
  next: Array<{ key: string; id: K; value: number }>,
  order: (a: K, b: K) => number,
): KeyedDiff<K> {
  const before = new Map(old.map((o) => [o.key, o]))
  const after = new Map(next.map((n) => [n.key, n]))
  const diff: KeyedDiff<K> = { added: [], changed: [], removed: [], unchangedCount: 0 }
  for (const n of after.values()) {
    const o = before.get(n.key)
    if (!o) diff.added.push({ ...n.id, to: n.value })
    else if (o.value !== n.value) diff.changed.push({ ...n.id, from: o.value, to: n.value })
    else diff.unchangedCount += 1
  }
  for (const o of before.values()) if (!after.has(o.key)) diff.removed.push({ ...o.id, from: o.value })
  diff.added.sort(order)
  diff.changed.sort(order)
  diff.removed.sort(order)
  return diff
}

const byDay = (a: { day: DayKey }, b: { day: DayKey }) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)

/** Re-import preview for Reinstatement Plan (spec §8): by day, old -> new. */
export function diffReinstatementPlan(old: ReinstatementPlanRow[], next: ReinstatementPlanRow[]): KeyedDiff<{ day: DayKey }> {
  const map = (rows: ReinstatementPlanRow[]) => rows.map((r) => ({ key: r.day, id: { day: r.day }, value: r.planQty }))
  return diffKeyed(map(old), map(next), byDay)
}

/**
 * Re-import preview for Manpower Plan (spec §8): by (group, day). The import
 * replaces the whole plan, so a group absent from the new file shows as removed.
 */
export function diffManpowerPlan(old: ManpowerValue[], next: ManpowerValue[]): KeyedDiff<{ groupId: string; day: DayKey }> {
  const map = (rows: ManpowerValue[]) => rows.map((r) => ({ key: `${r.groupId}|${r.day}`, id: { groupId: r.groupId, day: r.day }, value: r.value }))
  return diffKeyed(map(old), map(next), (a, b) => byDay(a, b) || a.groupId.localeCompare(b.groupId))
}

export type SpoolDiffField = Exclude<keyof SpoolMaster, 'spoolNo'> | keyof SpoolPlanDates | 'extra'

export interface SpoolFieldChange {
  field: SpoolDiffField
  /** The column label (the extra column's own label for `extra`). */
  label: string
  from: string | null
  to: string | null
}

export interface SpoolPlanDiff {
  /** New rows with no old spool to pair with. */
  added: SpoolPlanRow[]
  /** Old spools absent from the file: deleted WITH their actuals on confirm (Q19A). */
  removed: Array<{ spool: Spool; hasActuals: boolean }>
  /** Matched spools whose master, extra or plan values change; they keep their actuals. */
  changed: Array<{ spool: Spool; next: SpoolPlanRow; changes: SpoolFieldChange[] }>
  unchangedCount: number
  /** Every matched pair, old spool id -> new row seq: the replace keeps these ids' actuals. */
  matches: Array<{ oldId: string; nextSeq: number }>
}

const DIFF_FIELDS: Array<{ field: Exclude<SpoolDiffField, 'extra'>; label: string }> = [
  ...MASTER_KEYS.filter((k) => k !== 'spoolNo').map((k) => ({ field: k as Exclude<keyof SpoolMaster, 'spoolNo'>, label: SPOOL_MASTER_COLUMNS[k].label })),
  ...MILESTONES.map((m) => ({ field: PLAN_FIELD[m], label: SPOOL_PLAN_COLUMNS[m].label })),
]

/**
 * Re-import preview for Insulation Plan (spec §6.2): old and new spools are
 * paired by SpoolNo, duplicates paired in file order -- the i-th old spool with
 * a SpoolNo to the i-th new row with it (R-10). Unpaired new rows are added;
 * unpaired old spools are removed, flagged when they carry any actual.
 */
export function diffSpoolPlan(old: Spool[], next: SpoolPlanRow[]): SpoolPlanDiff {
  const queue = new Map<string, SpoolPlanRow[]>()
  for (const r of [...next].sort((a, b) => a.seq - b.seq)) {
    const key = spoolKey(r.spoolNo)
    const list = queue.get(key)
    if (list) list.push(r)
    else queue.set(key, [r])
  }
  const diff: SpoolPlanDiff = { added: [], removed: [], changed: [], unchangedCount: 0, matches: [] }
  const paired = new Set<number>()
  for (const spool of [...old].sort((a, b) => a.seq - b.seq)) {
    const candidate = queue.get(spoolKey(spool.spoolNo))?.shift()
    if (!candidate) {
      const hasActuals = Object.values(actualDates(spool)).some((d) => d !== null)
      diff.removed.push({ spool, hasActuals })
      continue
    }
    paired.add(candidate.seq)
    diff.matches.push({ oldId: spool.id, nextSeq: candidate.seq })
    const changes: SpoolFieldChange[] = []
    for (const { field, label } of DIFF_FIELDS) {
      const from = spool[field] ?? null
      const to = candidate[field] ?? null
      if (from !== to) changes.push({ field, label, from, to })
    }
    const labels = [...new Set([...Object.keys(spool.extra), ...Object.keys(candidate.extra)])]
    for (const label of labels) {
      const from = spool.extra[label] ?? null
      const to = candidate.extra[label] ?? null
      if (from !== to) changes.push({ field: 'extra', label, from, to })
    }
    if (changes.length > 0) diff.changed.push({ spool, next: candidate, changes })
    else diff.unchangedCount += 1
  }
  diff.added = next.filter((r) => !paired.has(r.seq)).sort((a, b) => a.seq - b.seq)
  return diff
}
