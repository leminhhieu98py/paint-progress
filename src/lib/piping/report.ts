import type { Workbook, Worksheet } from 'exceljs'
import {
  camProgress, camSeries, groupLateWarnings, lateSpoolCount, lateWarnings, MILESTONE_LABEL, MILESTONES,
  UNIT_LABEL, type CamPoint, type CamSeriesKey,
} from '../../domain/piping/cam'
import { chartGroups, manpowerAverages, manpowerSeries, type ManpowerPoint } from '../../domain/piping/manpower'
import { reinstatementSeries, reinstatementSummary, type ReinstatementPoint } from '../../domain/piping/reinstatement'
import type {
  DayKey, ManpowerGroup, ManpowerValue, NoteTarget, PipingSettings, ReinstatementActualEntry, ReinstatementPlanRow,
  Spool, Unit, ViewMode,
} from '../../domain/piping/types'
import type { Bucket } from '../../domain/piping/week'
import { toVNExcelDate } from '../format'
import type { PipingNoteEntry } from '../pipingApi/notes'

/**
 * The Piping report (spec §10, Q25, R-16): one workbook in the page's current
 * Ngày | Tuần view and Insulation unit -- Tóm tắt, Reinstatement, Manpower,
 * Insulation, Spool trễ, and Ghi chú for the admin only.
 *
 * Pure but for ExcelJS, imported dynamically as everywhere else
 * (reportXlsx.ts): the caller hands in the data it read and the chart PNGs it
 * rendered (`chartImage.ts`), so this runs in a test as it does in the
 * browser, and a chart that failed to render costs the file its picture, not
 * its numbers. Every figure comes from the domain functions the screen draws
 * with, so the file cannot disagree with the page.
 *
 * The chrome is the app's other exports': header tinted, bold, centred and
 * frozen, every cell ruled, real numbers and real dates with a format.
 */

/** The header tint and rule of the app's other exports (reportXlsx, templates). */
const HEADER_FILL = 'FFFAE2D5'
const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }
const DATE_FORMAT = 'dd/mm/yyyy'
const DATETIME_FORMAT = 'hh:mm:ss dd/mm/yyyy'
const PERCENT_FORMAT = '0.00%'
const INTEGER_FORMAT = '#,##0'
const DECIMAL_FORMAT = '#,##0.00'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** What a sheet writes where its chart could not be drawn. */
export const CHART_FAILED = 'Không vẽ được biểu đồ'

/** The width a chart picture takes on its sheet, in pixels; its height keeps the PNG's ratio. */
const IMAGE_WIDTH = 900

export type ChartKey = 'reinstatement' | 'manpower' | 'insulation'

/** A rendered chart: base64 PNG (no data-URL prefix) and its size in CSS pixels. */
export interface ChartPng {
  base64: string
  width: number
  height: number
}

/** A chart's picture, or 'failed' when it could not be drawn. Absent: no chart (no data). */
export type ReportChart = ChartPng | 'failed'

export interface PipingReportInput {
  project: { name: string; code: string }
  settings: Pick<PipingSettings, 'weekStartDate' | 'totalTestPacks' | 'lateThresholdDays'>
  mode: ViewMode
  /** The Insulation unit on screen (spec §6.4). */
  unit: Unit
  /** Today in Vietnam, as the page read it. */
  todayKey: DayKey
  reinstatement: {
    plan: ReinstatementPlanRow[]
    actual: Array<Pick<ReinstatementActualEntry, 'day' | 'qty'>>
  }
  manpower: { groups: ManpowerGroup[]; plan: ManpowerValue[]; actual: ManpowerValue[] }
  spools: Spool[]
  /** The admin's report only (spec §9): a GS or viewer report never has a Ghi chú sheet. */
  includeNotes: boolean
  notes: PipingNoteEntry[]
  charts: Partial<Record<ChartKey, ReportChart>>
}

/** The three charts' series, as the panels compute them. */
export interface PipingReportSeries {
  reinstatement: ReinstatementPoint[]
  manpower: { points: ManpowerPoint[]; groups: ManpowerGroup[] }
  insulation: { points: CamPoint[]; total: number }
}

/** The series the workbook writes; the caller renders the charts from the same ones and hands them back. */
export function pipingReportSeries(
  input: Pick<PipingReportInput, 'settings' | 'mode' | 'unit' | 'todayKey' | 'reinstatement' | 'manpower' | 'spools'>,
): PipingReportSeries {
  const { mode, todayKey } = input
  const weekStart = input.settings.weekStartDate
  const groups = chartGroups(input.manpower.groups, input.manpower.plan, input.manpower.actual)
  return {
    reinstatement: reinstatementSeries({ ...input.reinstatement, mode, weekStart, todayKey }),
    manpower: {
      points: manpowerSeries({ groups, plan: input.manpower.plan, actual: input.manpower.actual, mode, weekStart, todayKey }),
      groups,
    },
    insulation: camSeries({ spools: input.spools, unit: input.unit, mode, weekStart, todayKey }),
  }
}

/** `<project code>_Piping_<YYYY-MM-DD>.xlsx` (R-16). */
export function pipingReportFileName(projectCode: string, todayKey: DayKey): string {
  return `${projectCode}_Piping_${todayKey}.xlsx`
}

/**
 * A day key as an Excel date. UTC midnight: ExcelJS takes the serial from the
 * Date's UTC value, so the cell is the whole day number, on any machine.
 */
function dayCell(day: DayKey | null): Date | null {
  if (day === null) return null
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Header tinted, bold, centred and frozen; every written cell ruled. */
function dressSheet(sheet: Worksheet): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
      if (n === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
        cell.font = { bold: true }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      }
    })
  })
}

type Cell = string | number | Date | null

interface Column {
  header: string
  width: number
  /** The cells' number format; none for text. */
  numFmt?: string
}

/** Integers read as integers; a column holding any fraction shows two places. */
function quantityFormat(values: Array<number | null>): string {
  return values.every((v) => v === null || Number.isInteger(v)) ? INTEGER_FORMAT : DECIMAL_FORMAT
}

/** A table: the header row, then one row per entry, each column's format on its data cells. */
function writeTable(sheet: Worksheet, columns: Column[], rows: Cell[][]): void {
  sheet.columns = columns.map((c) => ({ header: c.header, width: c.width }))
  for (const values of rows) {
    const row = sheet.addRow(values)
    columns.forEach((c, i) => {
      if (c.numFmt) row.getCell(i + 1).numFmt = c.numFmt
    })
  }
  dressSheet(sheet)
}

/** The bucket's own columns: the day, or the week's first and last day. */
function bucketColumns(mode: ViewMode): Column[] {
  return mode === 'day'
    ? [{ header: 'Ngày', width: 13, numFmt: DATE_FORMAT }]
    : [{ header: 'Tuần (từ ngày)', width: 15, numFmt: DATE_FORMAT }, { header: 'Đến ngày', width: 13, numFmt: DATE_FORMAT }]
}

function bucketCells(bucket: Bucket, mode: ViewMode): Cell[] {
  return mode === 'day' ? [dayCell(bucket.start)] : [dayCell(bucket.start), dayCell(bucket.end)]
}

/** Numeric columns after the bucket columns, each formatted by what it holds. */
function seriesTable<P extends Bucket>(
  sheet: Worksheet,
  mode: ViewMode,
  points: P[],
  series: Array<{ header: string; value: (p: P) => number | null }>,
): void {
  const columns: Column[] = [
    ...bucketColumns(mode),
    ...series.map((s) => ({
      header: s.header,
      width: Math.max(12, Math.min(28, s.header.length + 2)),
      numFmt: quantityFormat(points.map(s.value)),
    })),
  ]
  writeTable(sheet, columns, points.map((p) => [...bucketCells(p, mode), ...series.map((s) => s.value(p))]))
}

/**
 * The chart beside its table: one empty column right of the data, from the
 * first row under the header, so it never sits over a figure or the frozen
 * pane. A chart that failed leaves a line under the table saying so.
 */
function placeChart(
  wb: Workbook,
  sheet: Worksheet,
  chart: ReportChart | undefined,
): void {
  if (chart === undefined) return
  if (chart === 'failed') {
    sheet.addRow([])
    const row = sheet.addRow([CHART_FAILED])
    row.getCell(1).font = { italic: true, color: { argb: 'FF8C8C8C' } }
    return
  }
  const id = wb.addImage({ base64: chart.base64, extension: 'png' })
  const height = chart.width > 0 ? Math.round((IMAGE_WIDTH * chart.height) / chart.width) : Math.round(IMAGE_WIDTH * 0.42)
  sheet.addImage(id, { tl: { col: sheet.columnCount + 1, row: 1 }, ext: { width: IMAGE_WIDTH, height } })
}

const VIEW_LABEL: Record<ViewMode, string> = { day: 'Ngày', week: 'Tuần' }
const BUCKET_WORD: Record<ViewMode, string> = { day: 'theo ngày', week: 'theo tuần' }
const NOTE_TARGET_LABEL: Record<NoteTarget, string> = {
  reinstatement_day: 'Reinstatement',
  manpower_day: 'Manpower',
  spool: 'Spool',
}

/** `series` are `pipingReportSeries(input)`, passed in when the caller already computed them for the charts. */
export async function buildPipingReport(
  input: PipingReportInput,
  series: PipingReportSeries = pipingReportSeries(input),
): Promise<Blob> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  wb.creator = 'paint-progress'
  const { mode, unit, todayKey, settings } = input
  const warnings = lateWarnings(input.spools, settings.lateThresholdDays, todayKey)

  // Tóm tắt: what the page's cards say, as numbers.
  const summary = wb.addWorksheet('Tóm tắt')
  const rein = reinstatementSummary(input.reinstatement.actual, settings.totalTestPacks)
  const averages = manpowerAverages({ ...input.manpower, todayKey })
  const progress = camProgress(input.spools, unit)
  const unitLabel = UNIT_LABEL[unit]
  summary.columns = [
    { header: 'Mục', width: 44 },
    { header: 'Giá trị', width: 22 },
    { header: 'Tổng', width: 12 },
    { header: '%', width: 10 },
  ]
  const summaryRow = (label: string, value: Cell, total: number | null = null, ratio: number | null = null, valueFmt?: string) => {
    const row = summary.addRow([label, value, total, ratio])
    if (valueFmt) row.getCell(2).numFmt = valueFmt
    row.getCell(3).numFmt = INTEGER_FORMAT
    row.getCell(4).numFmt = PERCENT_FORMAT
  }
  summaryRow('Dự án', `${input.project.name} (${input.project.code})`)
  summaryRow('Ngày xuất', dayCell(todayKey), null, null, DATE_FORMAT)
  summaryRow('Chế độ xem', VIEW_LABEL[mode])
  summaryRow('Đơn vị đếm Insulation', unitLabel)
  summaryRow('Reinstatement (TestPack)', rein.actual, rein.total, rein.ratio, quantityFormat([rein.actual]))
  summaryRow('Manpower – Plan trung bình đến hôm nay', averages.plan, null, null, DECIMAL_FORMAT)
  summaryRow('Manpower – Actual trung bình đến hôm nay', averages.actual, null, null, DECIMAL_FORMAT)
  for (const m of MILESTONES) {
    const ratio = progress.total > 0 ? progress.done[m] / progress.total : null
    summaryRow(`${MILESTONE_LABEL[m]} (${unitLabel})`, progress.done[m], progress.total, ratio, INTEGER_FORMAT)
  }
  summaryRow('Ngưỡng trễ (ngày)', settings.lateThresholdDays, null, null, INTEGER_FORMAT)
  summaryRow('Spool trễ', lateSpoolCount(warnings), null, null, INTEGER_FORMAT)
  dressSheet(summary)

  // Reinstatement: the chart's bars and lines, per bucket (spec §4, R-5).
  const word = BUCKET_WORD[mode]
  const reinstatement = wb.addWorksheet('Reinstatement')
  seriesTable(reinstatement, mode, series.reinstatement, [
    { header: `Plan ${word}`, value: (p) => p.plan },
    { header: `Actual ${word}`, value: (p) => p.actual },
    { header: 'Plan lũy kế', value: (p) => p.planCum },
    { header: 'Actual lũy kế', value: (p) => p.actualCum },
  ])
  placeChart(wb, reinstatement, input.charts.reinstatement)

  // Manpower: Plan and Actual per group, then the totals; a week is an average (R-2).
  const manpower = wb.addWorksheet('Manpower')
  const avg = mode === 'week' ? ' (trung bình)' : ''
  seriesTable(manpower, mode, series.manpower.points, [
    ...series.manpower.groups.flatMap((g) => [
      { header: `${g.name} – Plan${avg}`, value: (p: ManpowerPoint) => p.plan[g.id] ?? null },
      { header: `${g.name} – Actual${avg}`, value: (p: ManpowerPoint) => p.actual[g.id] ?? null },
    ]),
    { header: `Tổng Plan${avg}`, value: (p) => p.planTotal },
    { header: `Tổng Actual${avg}`, value: (p) => p.actualTotal },
  ])
  placeChart(wb, manpower, input.charts.manpower)

  // Insulation: the six cumulative lines in the unit on screen (spec §6.4).
  const insulation = wb.addWorksheet('Insulation')
  seriesTable(insulation, mode, series.insulation.points, MILESTONES.flatMap((m) => (['Plan', 'Actual'] as const).map((kind) => {
    const key = `${m}${kind}` as CamSeriesKey
    return { header: `${MILESTONE_LABEL[m]} – ${kind} lũy kế (${unitLabel})`, value: (p: CamPoint) => p[key] }
  })))
  placeChart(wb, insulation, input.charts.insulation)

  // Spool trễ: by package, as the screen's table groups it (spec §7).
  const late = wb.addWorksheet('Spool trễ')
  writeTable(late, [
    { header: 'SpoolNo', width: 30 },
    { header: 'LineNo', width: 26 },
    { header: 'Test Package No', width: 22 },
    { header: 'Mốc', width: 22 },
    { header: 'Bộ phận', width: 12 },
    { header: 'Plan', width: 13, numFmt: DATE_FORMAT },
    { header: 'Actual', width: 13, numFmt: DATE_FORMAT },
    { header: 'Số ngày trễ', width: 12, numFmt: INTEGER_FORMAT },
  ], groupLateWarnings(warnings, 'package').flatMap((g) => g.warnings).map((w) => [
    w.spoolNo, w.lineNo, w.testPackageNo, MILESTONE_LABEL[w.milestone], w.department,
    dayCell(w.plan), dayCell(w.actual), w.daysLate,
  ]))

  // Ghi chú: the admin's notes, never in a GS or viewer report (spec §9).
  if (input.includeNotes) {
    const spoolNo = new Map(input.spools.map((s) => [s.id, s.spoolNo]))
    const notes = wb.addWorksheet('Ghi chú')
    writeTable(notes, [
      { header: 'Mục', width: 15 },
      { header: 'Ngày', width: 13, numFmt: DATE_FORMAT },
      { header: 'Spool', width: 30 },
      { header: 'Nội dung', width: 60 },
      { header: 'Người viết', width: 24 },
      { header: 'Thời gian', width: 20, numFmt: DATETIME_FORMAT },
    ], input.notes.map((n) => [
      NOTE_TARGET_LABEL[n.target],
      dayCell(n.day),
      n.spoolId === null ? null : spoolNo.get(n.spoolId) ?? null,
      n.body,
      n.authorName,
      toVNExcelDate(n.createdAt),
    ]))
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_TYPE })
}
