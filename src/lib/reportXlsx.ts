import {
  buildOverviewRows, buildPlanRows, reportStageColumns, type DeckReportInput,
} from '../domain/report'

/**
 * The XLSX the client already reads, generated in the browser (spec §9).
 *
 * ExcelJS is imported dynamically and nowhere else. It is the largest dependency
 * in the tree, and the foreman's tablet must never download it: the GS screen is
 * opened on a site tether, and this button lives on an admin screen.
 *
 * Two sheets today -- `Overview` and `Plan`. Spec §9's per-deck sheets embed a
 * render of the drawing and the pie, which needs an offscreen Konva stage and an
 * offscreen chart node; that is a separate piece of work and is recorded as
 * outstanding rather than half-built here.
 */

/** Percentages are written as real numbers with a percent format, never as
 *  pre-formatted strings: the client sorts and re-totals these columns, and a
 *  string sorts as text and sums to zero. */
const PERCENT_FORMAT = '0.00%'
const AREA_FORMAT = '#,##0.00'

export interface ReportInput {
  projectName: string
  projectCode: string
  decks: DeckReportInput[]
}

export async function buildReportWorkbook(input: ReportInput): Promise<Blob> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  wb.creator = 'paint-progress'

  const stageNames = reportStageColumns(input.decks)
  const overview = wb.addWorksheet('Overview')

  overview.columns = [
    { header: 'Mã', key: 'code', width: 10 },
    { header: 'Sàn', key: 'name', width: 24 },
    { header: 'Tỉ trọng', key: 'share', width: 10, style: { numFmt: PERCENT_FORMAT } },
    { header: 'Diện tích (m²)', key: 'area', width: 15, style: { numFmt: AREA_FORMAT } },
    ...stageNames.flatMap((name) => [
      { header: `${name} (m²)`, key: `a:${name}`, width: 15, style: { numFmt: AREA_FORMAT } },
      { header: `${name} (%)`, key: `p:${name}`, width: 12, style: { numFmt: PERCENT_FORMAT } },
    ]),
    { header: '% Progress', key: 'progress', width: 12, style: { numFmt: PERCENT_FORMAT } },
    { header: '% Remain', key: 'remain', width: 12, style: { numFmt: PERCENT_FORMAT } },
  ]
  overview.getRow(1).font = { bold: true }

  for (const row of buildOverviewRows(input.decks)) {
    const values: Record<string, string | number> = {
      code: row.code,
      name: row.name,
      share: row.share,
      area: row.totalAreaM2,
      progress: row.progress,
      remain: row.remain,
    }
    for (const name of stageNames) {
      // Absent, not zero. A stage this deck does not declare leaves the cell
      // EMPTY -- to somebody pricing the work, 0 says "in the spec, none done"
      // and blank says "not in this deck's spec at all".
      if (name in row.stageAreaM2) {
        values[`a:${name}`] = row.stageAreaM2[name]
        values[`p:${name}`] = row.stageRatio[name]
      }
    }
    const added = overview.addRow(values)
    if (row.isTotal) added.font = { bold: true }
  }

  const plan = wb.addWorksheet('Plan')
  plan.columns = [
    { header: 'Sàn', key: 'deck', width: 24 },
    { header: 'Zone', key: 'zone', width: 20 },
    { header: 'Công đoạn', key: 'stage', width: 20 },
    { header: 'Diện tích (m²)', key: 'area', width: 15, style: { numFmt: AREA_FORMAT } },
    { header: 'Số ngày', key: 'days', width: 10 },
    { header: 'Bắt đầu', key: 'start', width: 14 },
    { header: 'Kết thúc', key: 'finish', width: 14 },
  ]
  plan.getRow(1).font = { bold: true }

  for (const row of buildPlanRows(input.decks)) {
    plan.addRow({
      deck: row.deckName,
      zone: row.zoneName,
      stage: row.stageName,
      area: row.areaM2,
      days: row.days ?? '',
      // Written as the ISO date-only strings they are. Handing ExcelJS a Date
      // would carry a timezone these values do not have, and shift every
      // planned start a day west of Greenwich -- the same trap domain/plan.ts
      // carries a warning about.
      start: row.startDate ?? '',
      finish: row.finishDate ?? '',
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** The filename the admin will be looking at in a folder of these next year. */
export function reportFileName(projectCode: string, today: string): string {
  return `tien-do-${projectCode}-${today}.xlsx`
}
