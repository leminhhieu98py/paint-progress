import { MILESTONES, PLAN_FIELD, actualDates, duplicateSpoolGroups, orderMessage, planDates, planOrderIssues,
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
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from './limits'
import { formatDayMonthYear } from './week'

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

/** Spec §8 limits, kept in a leaf module (see limits.ts) and re-exported here. */
export { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS }
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

/** Every built-in column of the spool files, for the extra-label collision check. */
const BUILT_IN_SPOOL_COLUMNS: ColumnSpec[] = [
  ...Object.values(SPOOL_MASTER_COLUMNS),
  ...Object.values(SPOOL_PLAN_COLUMNS),
  ...Object.values(SPOOL_ACTUAL_COLUMNS),
]

/**
 * The built-in spool header (its template label) that a file would read
 * `label` as, or null. An extra column must not carry such a label: the file
 * could not tell the two apart. Used by the import below and by the API when
 * the admin adds or renames an extra column.
 */
export function builtInSpoolHeader(label: string): string | null {
  const key = normalizeHeader(label)
  return BUILT_IN_SPOOL_COLUMNS.find((spec) => [spec.label, ...spec.aliases].some((n) => normalizeHeader(n) === key))?.label ?? null
}


// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * A BUILT-IN header as compared: case, whitespace (non-breaking included),
 * every dash (-, –, —, …), underscores and dots ignored. "Painting Handover –
 * Plan" and "painting handover - plan" are the same header.
 *
 * Too loose for names the admin types (groups, extra columns): the database
 * keeps those unique by `lower(btrim(name))` only, so "Mpr A" and "MprA" are
 * two groups. Those match by `nameKey` first (see `matchNames`).
 */
export function normalizeHeader(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[\s‐-―_.-]+/g, '')
}

/**
 * An admin-typed name as the database keeps it unique: `lower(btrim(name))`.
 * NFC first because Excel text may arrive decomposed; it only ever merges two
 * spellings of the SAME visible name, which the screen stores as NFC anyway,
 * so it can never merge two names the database holds apart.
 */
export function nameKey(text: string): string {
  return text.normalize('NFC').replace(/^ +| +$/g, '').toLowerCase()
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
/** Excel's day 0 in the 1900 system, as the serials of today's dates count from it. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const FIRST_DAY = '2000-01-01'
const LAST_DAY = '2100-12-31'
/** The window a date may fall in, 2000-01-01 .. 2100-12-31, checked BEFORE any Date is built. */
const WINDOW_START_MS = Date.UTC(2000, 0, 1)
const WINDOW_END_MS = Date.UTC(2101, 0, 1)
/** The same window as Excel serials: 36526 <= v < 73416. */
const SERIAL_START = (WINDOW_START_MS - EXCEL_EPOCH_MS) / MS_PER_DAY
const SERIAL_END = (WINDOW_END_MS - EXCEL_EPOCH_MS) / MS_PER_DAY
/** The largest |ms| whose day `msToDay` can still name: a day inside JS's Date range. */
const MAX_SAFE_MS = 8.64e15 - MS_PER_DAY

/**
 * The day of an Excel date, one rule for both paths a date reaches us by.
 *
 * Excel stores a date as a zone-less wall-clock serial, and ExcelJS hands a
 * date-formatted cell over as that wall clock read at UTC. So the UTC date IS
 * the calendar day the user typed -- a Vietnam day, since the users are in
 * Vietnam -- and no time-zone shift is applied (this is not an instant, so
 * `effortDayKey` does not apply). A bare serial (a date cell whose format was
 * lost) is turned into the same millisecond count. Both are then rounded to
 * the nearest second, absorbing a serial stored a hair under a whole day,
 * and floored to the day: the same cell content gives the same day whichever
 * path it takes.
 */
function msToDay(ms: number): DayKey {
  const seconds = Math.round(ms / 1000)
  const days = Math.floor(seconds / (MS_PER_DAY / 1000))
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10)
}

/** The day of a Date, or null for an invalid one or one too far out to name a day. */
function dateDay(d: Date): DayKey | null {
  const ms = d.getTime()
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_SAFE_MS ? msToDay(ms) : null
}

/** A cell as text in a message. */
function cellDisplay(v: CellValue): string {
  if (v instanceof Date) {
    const day = dateDay(v)
    return day === null ? '' : formatDayMonthYear(day)
  }
  return String(v ?? '').trim()
}

/** A text cell: trimmed, blank as null; a number or date as its text. */
export function textCell(v: CellValue): string | null {
  if (v === null) return null
  const s = v instanceof Date ? (dateDay(v) ?? '') : String(v).trim()
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
 * `-` or `.`) or `yyyy-mm-dd` text, or a bare Excel serial. Blank is null.
 * Years 2000-2100 only, which catches the mm/dd and two-digit-year slips a
 * construction plan would otherwise accept. Day rule: `msToDay`.
 */
export function parseDayCell(v: CellValue): { day: DayKey } | { error: string } | null {
  if (v === null) return null
  const bad = { error: `Ngày không hợp lệ: "${cellDisplay(v)}"` }
  const inRange = (day: DayKey) => (day >= FIRST_DAY && day <= LAST_DAY ? { day } : bad)
  // The window is checked on the raw value first: a far number (84901234567,
  // 1e300) or an invalid Date must be a row error, not a RangeError from
  // toISOString. The comparisons are false for NaN, so NaN is refused too.
  // `inRange` then catches a value rounded up past 2100-12-31.
  if (v instanceof Date) {
    const ms = v.getTime()
    return ms >= WINDOW_START_MS && ms < WINDOW_END_MS ? inRange(msToDay(ms)) : bad
  }
  if (typeof v === 'number') {
    return v >= SERIAL_START && v < SERIAL_END ? inRange(msToDay(EXCEL_EPOCH_MS + v * MS_PER_DAY)) : bad
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
 * Typed decimal text, STRICTLY: an optional "-", then digits with at most one
 * decimal separator and optional, well-formed thousands groups. Whitespace
 * (non-breaking and narrow included) is dropped first. Null for anything
 * else -- "12/05", "1:30", "(5)", "5%", "+3", "5 kg" -- which a lenient reader
 * would turn into a DIFFERENT number without a word.
 *
 * The shapes, and what they read as (the same readings as the screen's
 * `parseViDecimal`, components/viNumberInput.ts, on every shape both accept):
 *   1234             1234
 *   1234,5 1.234,5   1234.5   comma = decimal, dots = thousands (vi)
 *   1,234.5          1234.5   comma groups before one dot (en)
 *   1234.5 1.234     1234.5, 1.234   a single dot is a decimal point
 *   1.234.567        1234567  two or more dots can only be thousands
 */
export function parseDecimalText(text: string): number | null {
  const s = text.replace(/\s+/g, '')
  const sign = s.startsWith('-') ? '-' : ''
  const body = sign ? s.slice(1) : s
  let plain: string | null = null
  if (/^\d+$/.test(body)) plain = body
  else if (/^(\d+|\d{1,3}(\.\d{3})+),\d+$/.test(body)) plain = body.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(body)) plain = body.replace(/,/g, '')
  else if (/^\d+\.\d+$/.test(body)) plain = body
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(body)) plain = body.replace(/\./g, '')
  return plain === null ? null : Number(sign + plain)
}

/**
 * A number cell: a number, or text read by `parseDecimalText`. Blank is null;
 * any other text is "Không phải số". The sign is the caller's to check.
 */
export function parseNumberCell(v: CellValue): { value: number } | { error: string } | null {
  if (v === null) return null
  const bad = { error: `Không phải số: "${cellDisplay(v)}"` }
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : bad
  if (typeof v !== 'string') return bad
  if (v.trim() === '') return null
  const value = parseDecimalText(v)
  return value === null ? bad : { value }
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
function findHeader(sheets: SheetRows[], accept: (norm: string[], texts: string[]) => boolean): Header | null {
  for (const sheet of sheets) {
    const scan = Math.min(HEADER_SCAN_ROWS, sheet.rows.length)
    for (let index = 0; index < scan; index += 1) {
      const texts = (sheet.rows[index] ?? []).map((c) => textCell(c) ?? '')
      const norm = texts.map(normalizeHeader)
      if (accept(norm, texts)) return { sheet, index, texts, norm }
    }
  }
  return null
}

/**
 * The column of a built-in header: one headed by its label wins over one
 * headed by an alias, so a file with both "LineNo" and "Line" reads LineNo
 * from "LineNo" and leaves "Line" free for an extra column of that name.
 */
function columnOf(norm: string[], spec: ColumnSpec): number {
  const label = norm.indexOf(normalizeHeader(spec.label))
  if (label !== -1) return label
  const aliases = spec.aliases.map(normalizeHeader)
  return norm.findIndex((h) => h !== '' && aliases.includes(h))
}

const hasAll = (specs: ColumnSpec[]) => (norm: string[]) => specs.every((s) => columnOf(norm, s) !== -1)

/**
 * Admin-typed names (groups, extra column labels) against header cells.
 *
 * A header naming a name by `nameKey` -- exactly what the database keeps
 * unique -- takes it. Only then may a header match by the looser
 * `normalizeHeader`, and only when that names ONE name: "Mpr-for-Reins"
 * finds "Mpr for Reins", but "Mpr-A" finds neither "Mpr A" nor "MprA".
 * A second header for a name already taken is reported in `repeats`.
 * Columns in `skip` are not considered.
 */
function matchNames(
  texts: string[],
  names: string[],
  skip: Set<number>,
): { byColumn: Map<number, number>; repeats: Array<{ col: number; name: number }>; unmatched: number[] } {
  const exact = new Map<string, number>()
  names.forEach((n, i) => exact.set(nameKey(n), i))
  const loose = new Map<string, number[]>()
  names.forEach((n, i) => {
    const k = normalizeHeader(n)
    loose.set(k, [...(loose.get(k) ?? []), i])
  })
  const byColumn = new Map<number, number>()
  const taken = new Set<number>()
  const repeats: Array<{ col: number; name: number }> = []
  const unmatched: number[] = []
  const claim = (col: number, name: number) => {
    if (taken.has(name)) repeats.push({ col, name })
    else {
      taken.add(name)
      byColumn.set(col, name)
    }
  }
  const pending: number[] = []
  texts.forEach((t, col) => {
    if (t === '' || skip.has(col)) return
    const i = exact.get(nameKey(t))
    if (i === undefined) pending.push(col)
    else claim(col, i)
  })
  for (const col of pending) {
    const candidates = loose.get(normalizeHeader(texts[col])) ?? []
    if (candidates.length === 1) claim(col, candidates[0])
    else unmatched.push(col)
  }
  return { byColumn, repeats, unmatched }
}

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
    errors.push({ row, message: `Ngày ${formatDayMonthYear(parsed.day)} trùng với dòng ${first}` })
    return null
  }
  seen.set(parsed.day, row)
  return parsed.day
}

const VI_AMOUNT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 })

/**
 * "1,234" is a vi decimal (1.234) here, but in an English file it is one
 * thousand two hundred thirty-four: read as vi, and said so in a warning that
 * does not block the import.
 */
function commaReading(v: CellValue, value: number): string | null {
  if (typeof v !== 'string') return null
  const text = v.replace(/\s+/g, '')
  if (!/^\d+,\d{3}$/.test(text)) return null
  return `"${text}" được đọc là ${VI_AMOUNT.format(value)} (dấu phẩy là dấu thập phân), không phải ${text.replace(',', '')}`
}

/** A number >= 0 under `label`; null when blank (and pushes nothing). */
function readAmount(
  v: CellValue, label: string, row: number, errors: ImportIssue[], warnings: ImportIssue[],
): number | null | undefined {
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
  const note = commaReading(v, parsed.value)
  if (note !== null) warnings.push({ row, message: note })
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
  const warnings: ImportIssue[] = []
  const rows: ReinstatementPlanRow[] = []
  const seen = new Map<DayKey, number>()
  for (const { row, cells } of data) {
    const day = readDate(cells, dateCol, row, seen, errors)
    const qty = readAmount(cellAt(cells, qtyCol), PLAN_QTY_COLUMN.label, row, errors, warnings)
    if (qty === null) errors.push({ row, message: `Thiếu ${PLAN_QTY_COLUMN.label}` })
    if (day !== null && typeof qty === 'number') rows.push({ day, planQty: qty })
  }
  return finish(header.sheet.name, rows, data.length, errors, warnings)
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
  const names = groups.map((g) => g.name)
  const groupsIn = (norm: string[], texts: string[]) => {
    const dateCol = columnOf(norm, DATE_COLUMN)
    return matchNames(texts, names, new Set(dateCol === -1 ? [] : [dateCol]))
  }
  // A workbook may carry other sheets with a date column (the customer's own
  // has three): the one naming a group wins, else the first with a date.
  const header = findHeader(sheets, (norm, texts) => columnOf(norm, DATE_COLUMN) !== -1 && groupsIn(norm, texts).byColumn.size > 0)
    ?? findHeader(sheets, hasAll([DATE_COLUMN]))
  if (!header) return empty(null, [missingHeader(DATE_COLUMN.label)])
  const dateCol = columnOf(header.norm, DATE_COLUMN)
  const headerRow = header.index + 1
  const matched = groupsIn(header.norm, header.texts)
  const columns = [...matched.byColumn.entries()].sort(([a], [b]) => a - b).map(([col, i]) => ({ col, group: groups[i] }))
  const unknown = matched.unmatched.sort((a, b) => a - b).map((col) => header.texts[col])
  const errors: ImportIssue[] = matched.repeats.map((r) => ({ row: headerRow, message: `Cột nhóm ${groups[r.name].name} lặp lại` }))
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
      const value = readAmount(cellAt(cells, col), group.name, row, errors, warnings)
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
  const labels = extraColumns.map((c) => c.label)
  const extraMatch = matchNames(header.texts, labels, used)
  const extraCol = [...extraMatch.byColumn.entries()].sort(([a], [b]) => a - b).map(([col, i]) => ({ col, label: labels[i] }))
  for (const { col } of extraCol) used.add(col)
  // A label that is also a built-in header name cannot be told from it by a
  // file; unless the file has a second column for it, say so rather than
  // leaving the extra column silently empty.
  const filled = new Set(extraMatch.byColumn.values())
  labels.forEach((label, i) => {
    if (filled.has(i)) return
    const builtIn = builtInSpoolHeader(label)
    if (builtIn) {
      warnings.push({
        row: headerRow,
        message: `Cột thêm "${label}" trùng tên cột chuẩn ${builtIn} nên không đọc được; đổi tên cột thêm trong Cấu hình`,
      })
    }
  })
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
    warnings.push({ row: issue.row.row, message: orderMessage(planDates(issue.row), issue.pairs) })
  }
  for (const d of duplicates) {
    warnings.push({ row: null, message: `SpoolNo "${d.spoolNo}" lặp lại ở các dòng ${d.rows.map((r) => r.row).join(', ')}` })
  }
  return { ...finish(header.sheet.name, rows, data.length, errors, warnings), duplicates, planOrder }
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
  /** Every requested change, one per matching spool and milestone, no-ops included (for display). Empty on any error. */
  changes: ActualChange[]
  /** THE payload: per spool, no-op dates dropped -- what the RPC receives (flattened by the API layer). */
  updates: ActualResolution['updates']
  /** Existing dates the import replaces, old -> new: confirm first. */
  overwrites: Array<ActualOverwrite & { row: number }>
  /** Dates equal to what is stored. */
  unchangedCount: number
  /** Distinct spools the import changes (`updates.length`), for the preview and the confirm. */
  spoolCount: number
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
      errors.push({ row: r.row, message: `${SPOOL_ACTUAL_COLUMNS[future].label}: ngày ${formatDayMonthYear(r.dates[future]!)} sau hôm nay` })
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
  if (errors.length > 0) return { errors, warnings, changes: [], updates: [], overwrites: [], unchangedCount: 0, spoolCount: 0 }
  return {
    errors,
    warnings,
    changes,
    updates: resolved.updates,
    overwrites: resolved.overwrites.map((o) => ({ row: rowOfSpool.get(o.spoolId)!, ...o })),
    unchangedCount: resolved.unchanged.length,
    spoolCount: resolved.updates.length,
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
  return diffKeyed(map(old), map(next), (a, b) => byDay(a, b) || (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0))
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
