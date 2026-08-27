import {
  buildCellListRows, buildOverviewRows, buildPlanRows, reportStageColumns,
  type DeckReportInput,
} from '../domain/report'
import { computeDeckProgress } from '../domain/progress'

/**
 * The XLSX the client already reads, generated in the browser (spec §9).
 *
 * ExcelJS is imported dynamically and nowhere else. It is the largest dependency
 * in the tree, and the foreman's tablet must never download it: the GS screen is
 * opened on a site tether, and this button lives on an admin screen.
 *
 * `Overview`, one sheet per deck, then `Plan`.
 *
 * The per-deck images are rendered by the CALLER and handed in, not produced
 * here. Rendering needs a live canvas; keeping it out means this module and its
 * tests run anywhere, and a deck whose drawing fails to render still gets its
 * numbers rather than taking the whole export down.
 */

/** Percentages are written as real numbers with a percent format, never as
 *  pre-formatted strings: the client sorts and re-totals these columns, and a
 *  string sorts as text and sums to zero. */
const PERCENT_FORMAT = '0.00%'
const AREA_FORMAT = '#,##0.00'

/** PNG data URLs for one deck, produced by the caller. Either may be null: a
 *  deck with no drawing has no snapshot to take, and a render that failed must
 *  not cost the deck its numbers. */
export interface DeckImages {
  drawingPng: string | null
  piePng: string | null
}

export interface ReportInput {
  projectName: string
  projectCode: string
  decks: DeckReportInput[]
  /** Keyed by deck id. Absent entries simply mean no pictures on that sheet. */
  images?: Record<string, DeckImages>
}

/**
 * Excel forbids `[ ] : * ? / \` in a sheet name and caps it at 31 characters,
 * and it silently refuses a workbook with two sheets of one name. A deck code is
 * short and unique within a project, so collisions are near-impossible -- but a
 * report that throws on a deck called `A/B` is worse than one that calls it
 * `A-B`, and a numeric suffix costs nothing.
 */
export function sheetNameFor(code: string, taken: Set<string>): string {
  const cleaned = (code.replace(/[[\]:*?/\\]/g, '-').trim() || 'Deck').slice(0, 31)
  let name = cleaned
  let n = 2
  while (taken.has(name)) {
    const suffix = ` (${n})`
    name = cleaned.slice(0, 31 - suffix.length) + suffix
    n += 1
  }
  taken.add(name)
  return name
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

  // One sheet per deck, between Overview and Plan: the row-level evidence
  // behind the figures above, in the order the decks are laid out on the
  // platform.
  const taken = new Set<string>(['Overview', 'Plan'])
  for (const entry of input.decks) {
    const sheet = wb.addWorksheet(sheetNameFor(entry.deck.code, taken))
    const progress = computeDeckProgress(entry.deck, entry.stages)

    sheet.addRow([entry.deck.name, `${entry.deck.code}`])
    sheet.getRow(1).font = { bold: true, size: 14 }
    sheet.addRow(['Diện tích sàn (m²)', entry.deck.totalAreaM2])
    sheet.getCell('B2').numFmt = AREA_FORMAT
    if (entry.areaSource === 'prorated') {
      // Spec §9 requires this disclosed. A prorated area was divided out of the
      // declared total rather than measured off the drawing, and somebody
      // pricing a variation needs to know which they are looking at.
      sheet.addRow(['Ghi chú', 'Diện tích từng ô được chia theo tỉ lệ từ tổng diện tích khai báo, không đo từ bản vẽ.'])
    }
    sheet.addRow([])

    // The `Dashboard` sheet's two rows, per deck, in its own words.
    const deckStageNames = entry.stages.map((st: { name: string }) => st.name)
    sheet.addRow(['', ...deckStageNames])
    sheet.lastRow!.font = { bold: true }
    const areaRow = sheet.addRow(['m²', ...progress.stages.map((sp) => sp.cumulativeAreaM2)])
    const ratioRow = sheet.addRow(['% Total Deck', ...progress.stages.map((sp) => sp.ratio)])
    for (let i = 2; i <= deckStageNames.length + 1; i += 1) {
      areaRow.getCell(i).numFmt = AREA_FORMAT
      ratioRow.getCell(i).numFmt = PERCENT_FORMAT
    }
    sheet.addRow(['% Progress', progress.progress]).getCell(2).numFmt = PERCENT_FORMAT
    sheet.addRow([])

    const pictures = input.images?.[entry.deck.id]
    if (pictures?.drawingPng) {
      const id = wb.addImage({ base64: pictures.drawingPng, extension: 'png' })
      sheet.addImage(id, { tl: { col: 7, row: 1 }, ext: { width: 520, height: 380 } })
    }
    if (pictures?.piePng) {
      const id = wb.addImage({ base64: pictures.piePng, extension: 'png' })
      sheet.addImage(id, { tl: { col: 15, row: 1 }, ext: { width: 260, height: 260 } })
    }

    const listHeader = sheet.addRow(['Mã ô', 'Diện tích (m²)', 'Công đoạn', 'Cập nhật lúc', 'Bởi'])
    listHeader.font = { bold: true }
    sheet.getColumn(1).width = 12
    sheet.getColumn(2).width = 15
    sheet.getColumn(3).width = 18
    sheet.getColumn(4).width = 22
    sheet.getColumn(5).width = 20
    for (const cell of buildCellListRows(entry)) {
      const row = sheet.addRow([
        cell.code, cell.areaM2, cell.stageName, cell.updatedAt ?? '', cell.updatedBy ?? '',
      ])
      row.getCell(2).numFmt = AREA_FORMAT
    }
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
