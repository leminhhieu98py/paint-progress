import {
  DATE_COLUMN,
  PLAN_QTY_COLUMN,
  SPOOL_ACTUAL_COLUMNS,
  SPOOL_MASTER_COLUMNS,
  SPOOL_PLAN_COLUMNS,
} from '../../domain/piping/imports'
import type { ImportKind } from '../../domain/piping/types'

/**
 * The "Tải file mẫu" workbooks (spec §8): one header row per import, built in
 * the browser. The headers come from `domain/piping/imports.ts`, the module
 * that reads them back, so a template can never drift from its importer.
 *
 * Header only, no example row: an example left in by mistake would be
 * imported as plan. Date columns are formatted dd/mm/yyyy so what the admin
 * types reads back as a date. ExcelJS is imported dynamically (reportXlsx.ts).
 */

/** The header tint and rule of the app's other exports (employeesXlsx, reportXlsx). */
const HEADER_FILL = 'FFFAE2D5'
const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }
const DATE_FORMAT = 'dd/mm/yyyy'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface TemplateColumn {
  header: string
  width: number
  date?: boolean
}

async function buildTemplate(sheetName: string, columns: TemplateColumn[]): Promise<Blob> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  wb.creator = 'paint-progress'
  const sheet = wb.addWorksheet(sheetName)
  sheet.columns = columns.map((c) => ({
    header: c.header,
    width: c.width,
    ...(c.date ? { style: { numFmt: DATE_FORMAT } } : {}),
  }))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.font = { bold: true }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    // The column style would format the header cell as a date too.
    cell.numFmt = 'General'
  })
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_TYPE })
}

/** `Date`, `Plan Qty`. */
export function buildReinstatementPlanTemplate(): Promise<Blob> {
  return buildTemplate('Reinstatement Plan', [
    { header: DATE_COLUMN.label, width: 14, date: true },
    { header: PLAN_QTY_COLUMN.label, width: 12 },
  ])
}

/** `Date` + one column per group name, in the order given (visible and hidden, spec §8). */
export function buildManpowerPlanTemplate(groupNames: string[]): Promise<Blob> {
  return buildTemplate('Manpower Plan', [
    { header: DATE_COLUMN.label, width: 14, date: true },
    ...groupNames.map((name) => ({ header: name, width: Math.max(12, name.length + 2) })),
  ])
}

/** The six master columns, the three Plan dates, then the extra columns in the order given. */
export function buildSpoolPlanTemplate(extraLabels: string[]): Promise<Blob> {
  return buildTemplate('Insulation Plan', [
    { header: SPOOL_MASTER_COLUMNS.spoolNo.label, width: 36 },
    { header: SPOOL_MASTER_COLUMNS.lineNo.label, width: 32 },
    { header: SPOOL_MASTER_COLUMNS.insuType.label, width: 10 },
    { header: SPOOL_MASTER_COLUMNS.drawingNo.label, width: 36 },
    { header: SPOOL_MASTER_COLUMNS.testPackageNo.label, width: 26 },
    { header: SPOOL_MASTER_COLUMNS.paintingSystem.label, width: 16 },
    { header: SPOOL_PLAN_COLUMNS.ph.label, width: 16, date: true },
    { header: SPOOL_PLAN_COLUMNS.ih.label, width: 16, date: true },
    { header: SPOOL_PLAN_COLUMNS.iw.label, width: 16, date: true },
    ...extraLabels.map((label) => ({ header: label, width: Math.max(12, label.length + 2) })),
  ])
}

/** `SpoolNo` and the three Actual dates. */
export function buildSpoolActualTemplate(): Promise<Blob> {
  return buildTemplate('Insulation Actual', [
    { header: SPOOL_MASTER_COLUMNS.spoolNo.label, width: 36 },
    { header: SPOOL_ACTUAL_COLUMNS.ph.label, width: 16, date: true },
    { header: SPOOL_ACTUAL_COLUMNS.ih.label, width: 16, date: true },
    { header: SPOOL_ACTUAL_COLUMNS.iw.label, width: 16, date: true },
  ])
}

const TEMPLATE_NAME: Record<ImportKind, string> = {
  reinstatement_plan: 'Mau_Reinstatement_Plan.xlsx',
  manpower_plan: 'Mau_Manpower_Plan.xlsx',
  spool_plan: 'Mau_Insulation_Plan.xlsx',
  spool_actual: 'Mau_Insulation_Actual.xlsx',
}

/** The template's file name: ASCII, so every phone and mail client keeps it intact. */
export function templateFileName(kind: ImportKind): string {
  return TEMPLATE_NAME[kind]
}
