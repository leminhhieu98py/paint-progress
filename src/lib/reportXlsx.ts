import {
  buildCellListRows, buildOverviewRows, buildPlanRows, reportStageColumns,
  type DeckReportInput,
} from '../domain/report'
import type { Worksheet } from 'exceljs'
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
const DATE_FORMAT = 'dd/mm/yyyy'

/** The header tint on the customer's own Dashboard sheet. Matched so the export
 *  drops into a folder of their workbooks without announcing itself. */
const HEADER_FILL = 'FFFAE2D5'

const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }

/**
 * Rules the customer's workbook follows and a bare `addRow` does not: every
 * cell ruled, the header tinted and frozen.
 *
 * Freezing is not decoration on these sheets. A deck's bay listing runs to two
 * hundred rows, and a column of numbers with the header scrolled off is a column
 * of numbers nobody can read.
 */
function dressSheet(sheet: Worksheet, headerRows: number): void {
  sheet.views = [{ state: 'frozen', ySplit: headerRows }]
  sheet.eachRow({ includeEmpty: false }, (row: ReturnType<Worksheet['getRow']>, n: number) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
      if (n <= headerRows) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
        cell.font = { bold: true }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      }
    })
  })
}

/**
 * An ISO date-only string as a cell Excel can sort and filter.
 *
 * Anchored at LOCAL NOON, not midnight. ExcelJS converts a Date through the
 * host's offset, and a midnight date east or west of UTC lands on the day
 * before or after -- the same trap domain/plan.ts carries a warning about, one
 * layer down. Noon survives any offset the world actually uses.
 */
function dateCell(iso: string | null): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

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

  /**
   * Three header rows, matching the customer's own Dashboard sheet: the weight
   * over each stage, the stage name spanning its pair of columns, then `m²` and
   * `% Total Deck` under it.
   *
   * Flat headers were readable and wrong for the job. This file lands in a
   * folder beside the workbook it replaces, in front of people who have read
   * that layout for months, and the weights row is not decoration -- it is the
   * only thing on the sheet that explains how `% Progress` was arrived at.
   */
  const FIXED = ['Mã', 'Sàn', 'Tỉ trọng', 'Diện tích (m²)']
  const firstStageCol = FIXED.length + 1

  const weightOf = (name: string) => {
    for (const d of input.decks) {
      const st = d.stages.find((x) => x.name === name)
      if (st) return st.weight
    }
    return null
  }

  // Row 1: the weights, each over its stage's percentage column.
  const weightRow = overview.addRow([])
  stageNames.forEach((name, i) => {
    const cell = weightRow.getCell(firstStageCol + i * 2 + 1)
    const w = weightOf(name)
    if (w !== null) { cell.value = w; cell.numFmt = PERCENT_FORMAT }
  })

  // Row 2: fixed headers, then each stage name spanning its two columns.
  const nameRow = overview.addRow([...FIXED, ...stageNames.flatMap((n) => [n, ''])])
  nameRow.getCell(FIXED.length + stageNames.length * 2 + 1).value = '% Progress'
  nameRow.getCell(FIXED.length + stageNames.length * 2 + 2).value = '% Remain'

  // Row 3: the pair under each stage.
  const unitRow = overview.addRow(['', '', '', '', ...stageNames.flatMap(() => ['m²', '% Total Deck'])])

  stageNames.forEach((_, i) => {
    const c = firstStageCol + i * 2
    overview.mergeCells(2, c, 2, c + 1)
  })
  // The fixed columns and the two totals span the name and unit rows.
  for (let c = 1; c <= FIXED.length; c += 1) overview.mergeCells(2, c, 3, c)
  const progCol = FIXED.length + stageNames.length * 2 + 1
  overview.mergeCells(2, progCol, 3, progCol)
  overview.mergeCells(2, progCol + 1, 3, progCol + 1)
  unitRow.height = 28

  overview.getColumn(1).width = 10
  overview.getColumn(2).width = 24
  overview.getColumn(3).width = 10
  overview.getColumn(4).width = 15
  for (let i = 0; i < stageNames.length; i += 1) {
    overview.getColumn(firstStageCol + i * 2).width = 14
    overview.getColumn(firstStageCol + i * 2 + 1).width = 13
  }
  overview.getColumn(progCol).width = 12
  overview.getColumn(progCol + 1).width = 12

  for (const row of buildOverviewRows(input.decks)) {
    const values: (string | number | null)[] = [
      row.code, row.name, row.share, row.totalAreaM2,
    ]
    for (const name of stageNames) {
      // Absent, not zero. A stage this deck does not declare leaves the cell
      // EMPTY -- to somebody pricing the work, 0 says "in the spec, none done"
      // and blank says "not in this deck's spec at all".
      const has = name in row.stageAreaM2
      values.push(has ? row.stageAreaM2[name] : null)
      values.push(has ? row.stageRatio[name] : null)
    }
    values.push(row.progress, row.remain)
    const added = overview.addRow(values)
    added.getCell(3).numFmt = PERCENT_FORMAT
    added.getCell(4).numFmt = AREA_FORMAT
    for (let i = 0; i < stageNames.length; i += 1) {
      added.getCell(firstStageCol + i * 2).numFmt = AREA_FORMAT
      added.getCell(firstStageCol + i * 2 + 1).numFmt = PERCENT_FORMAT
    }
    added.getCell(progCol).numFmt = PERCENT_FORMAT
    added.getCell(progCol + 1).numFmt = PERCENT_FORMAT
    if (row.isTotal) added.font = { bold: true }
  }

  dressSheet(overview, 3)

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

    // Frozen at the listing header, and filterable: two hundred bays is a list
    // somebody scrolls looking for one code, and a header that scrolls away
    // leaves five unlabelled columns.
    sheet.views = [{ state: 'frozen', ySplit: listHeader.number }]
    sheet.autoFilter = {
      from: { row: listHeader.number, column: 1 },
      to: { row: sheet.rowCount, column: 5 },
    }
    listHeader.eachCell({ includeEmpty: true }, (c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    })
  }

  // Mirrors the customer's `Kế hoạch tháo GG`: where, what, unit, quantity,
  // days, the window, and a column to write in. `Đơn vị` is always m² here --
  // a constant column, kept because it is one of theirs and the sheet is meant
  // to drop into the habit rather than replace it.
  const plan = wb.addWorksheet('Plan')
  plan.columns = [
    { header: 'Sàn', key: 'deck', width: 24 },
    { header: 'Vị trí tháo GG', key: 'zone', width: 22 },
    { header: 'Công đoạn', key: 'stage', width: 20 },
    { header: 'Đơn vị', key: 'unit', width: 9 },
    { header: 'Khối lượng', key: 'area', width: 14, style: { numFmt: AREA_FORMAT } },
    { header: 'Số ngày', key: 'days', width: 10 },
    { header: 'Bắt đầu', key: 'start', width: 14, style: { numFmt: DATE_FORMAT } },
    { header: 'Kết thúc', key: 'finish', width: 14, style: { numFmt: DATE_FORMAT } },
    { header: 'Ghi chú', key: 'note', width: 28 },
  ]

  for (const row of buildPlanRows(input.decks)) {
    plan.addRow({
      deck: row.deckName,
      zone: row.zoneName,
      stage: row.stageName,
      unit: 'm²',
      area: row.areaM2,
      days: row.days ?? '',
      // Real dates, anchored at local noon -- see dateCell. Written as text
      // before this, which read correctly and sorted as strings, so a client
      // sorting the plan by start date got alphabetical order.
      start: dateCell(row.startDate),
      finish: dateCell(row.finishDate),
      note: '',
    })
  }

  dressSheet(plan, 1)

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** The filename the admin will be looking at in a folder of these next year. */
export function reportFileName(projectCode: string, today: string): string {
  return `tien-do-${projectCode}-${today}.xlsx`
}
