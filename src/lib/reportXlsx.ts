import type { Worksheet } from 'exceljs'
import { computeDeckProgress, summariseDeck } from '../domain/progress'
import { buildEventRows, buildOverview, buildPlanRows, type DeckReportInput } from '../domain/report'
import type { WorkModel } from '../domain/types'
import { toVNExcelDate } from './format'

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
/*
  Time first, then date, matching the paperwork: on a deck the question is
  almost always "when today", and the date is the part that repeats down the
  column. The cell holds a real date (see toVNExcelDate) rather than a
  preformatted string, so sorting and filtering the column still work.
*/
const DATETIME_FORMAT = 'hh:mm:ss dd/mm/yyyy'

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
  ruleSheet(sheet, (n) => n <= headerRows)
}

/** Every cell ruled; the rows `isHeader` names tinted, bold and centred. */
function ruleSheet(sheet: Worksheet, isHeader: (rowNumber: number) => boolean): void {
  sheet.eachRow({ includeEmpty: false }, (row: ReturnType<Worksheet['getRow']>, n: number) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
      if (isHeader(n)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
        cell.font = { ...cell.font, bold: true }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      }
    })
  })
}

/** A work that is on the sheet but not in P (RPT-26): shown, greyed. */
const GREY_FONT = { color: { argb: 'FF8C8C8C' } }
const FIXED = ['Mã', 'Sàn', 'Tỉ trọng', 'Diện tích (m²)']

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
  /**
   * The drawing's height divided by its width.
   *
   * Excel sizes a picture from the box it is given, so a fixed box stretches
   * every sheet that is not that shape -- the old 520x380 squashed a portrait
   * deck and stretched a landscape one, on the image someone matches against
   * the paper drawing in their hand. The caller knows the real dimensions
   * (`decks.image_w` / `image_h`); this carries them the one number the sizing
   * needs. Absent falls back to a fixed box, so a caller that cannot work it
   * out still gets a picture.
   */
  drawingAspect?: number | null
}

export interface ReportInput {
  projectName: string
  projectCode: string
  /**
   * Every work of the project: the bays works with their decks, coats and
   * states, the manual ones with their figure. The Overview is built from
   * these and nothing else, so its blocks are the screens' own numbers.
   */
  works: WorkModel[]
  /** Every deck once, in seq order, with what only its own sheet needs. */
  decks: DeckReportInput[]
  /** Keyed by deck id. Absent entries simply mean no pictures on that sheet. */
  images?: Record<string, DeckImages>
  /**
   * 'deck' is the tablet's export of the one deck tab it has open (Feedback
   * Rv1, item 6) and carries no Overview sheet: one row at 100% weight headed
   * "TỔNG DỰ ÁN" would be a project total that does not exist. Default
   * 'project' -- the admin's, every deck, with the Overview.
   */
  scope?: 'project' | 'deck'
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

  const overview = wb.addWorksheet('Overview')
  const { blocks, manual, total } = buildOverview(input.works)
  const headerRows = new Set<number>()
  let widestBlock = 0

  /**
   * One block per bays work (RPT-26): a title naming the work and its weight,
   * then the customer's own three header rows -- the coat weight over each
   * stage, the stage name spanning its pair of columns, `m²` and `% Total Deck`
   * under it -- one row per participating deck, and the work's subtotal.
   *
   * Flat headers were readable and wrong for the job. This file lands in a
   * folder beside the workbook it replaces, in front of people who have read
   * that layout for months, and the weights row is not decoration -- it is the
   * only thing on the sheet that explains how `% Progress` was arrived at.
   */
  for (const block of blocks) {
    const firstStageCol = FIXED.length + 1
    const progCol = FIXED.length + block.stageNames.length * 2 + 1
    widestBlock = Math.max(widestBlock, block.stageNames.length)
    const counted = block.work.counts

    const title = overview.addRow([
      `${block.work.name} · trọng số ${counted ? formatPercentText(block.work.weight) : '—'}`
      + ` · ${counted ? 'tính vào tổng' : 'không tính vào tổng'}`,
    ])
    title.font = { bold: true, size: 12, ...(counted ? {} : GREY_FONT) }

    // The weights, each over its stage's percentage column.
    const weightRow = overview.addRow([])
    block.stageNames.forEach((name, i) => {
      const cell = weightRow.getCell(firstStageCol + i * 2 + 1)
      cell.value = block.weights[name]
      cell.numFmt = PERCENT_FORMAT
    })

    // Fixed headers, then each stage name spanning its two columns.
    const nameRow = overview.addRow([...FIXED, ...block.stageNames.flatMap((n) => [n, ''])])
    nameRow.getCell(progCol).value = '% Progress'
    nameRow.getCell(progCol + 1).value = '% Remain'

    // The pair under each stage.
    const unitRow = overview.addRow(['', '', '', '', ...block.stageNames.flatMap(() => ['m²', '% Total Deck'])])
    block.stageNames.forEach((_, i) => {
      const c = firstStageCol + i * 2
      overview.mergeCells(nameRow.number, c, nameRow.number, c + 1)
    })
    // The fixed columns and the two totals span the name and unit rows.
    for (let c = 1; c <= FIXED.length; c += 1) overview.mergeCells(nameRow.number, c, unitRow.number, c)
    overview.mergeCells(nameRow.number, progCol, unitRow.number, progCol)
    overview.mergeCells(nameRow.number, progCol + 1, unitRow.number, progCol + 1)
    unitRow.height = 28
    for (const n of [title.number, weightRow.number, nameRow.number, unitRow.number]) headerRows.add(n)

    for (const row of [...block.rows, block.subtotal]) {
      const values: (string | number | null)[] = [
        row.code, row.name, row.share, row.totalAreaM2,
      ]
      for (const name of block.stageNames) {
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
      for (let i = 0; i < block.stageNames.length; i += 1) {
        added.getCell(firstStageCol + i * 2).numFmt = AREA_FORMAT
        added.getCell(firstStageCol + i * 2 + 1).numFmt = PERCENT_FORMAT
      }
      added.getCell(progCol).numFmt = PERCENT_FORMAT
      added.getCell(progCol + 1).numFmt = PERCENT_FORMAT
      if (row.isTotal || !counted) added.font = { bold: row.isTotal, ...(counted ? {} : GREY_FONT) }
    }
    overview.addRow([])
  }

  /**
   * The works that are in P but on no deck -- chứng từ, xà lan -- and P
   * itself. A work that does not count is still listed, greyed, so the sheet
   * says what is tracked and what the total is made of; the weights of the
   * counted works are what sums to one.
   */
  const worksHeader = overview.addRow(['', 'Công việc', 'Trọng số', 'Loại', '% Progress'])
  headerRows.add(worksHeader.number)
  for (const m of manual) {
    const row = overview.addRow([
      '',
      m.work.name,
      m.work.counts ? m.work.weight : '—',
      m.work.counts ? 'Nhập tay' : 'Không tính vào tổng',
      m.progress,
    ])
    if (m.work.counts) row.getCell(3).numFmt = PERCENT_FORMAT
    else row.font = { ...GREY_FONT }
    row.getCell(5).numFmt = PERCENT_FORMAT
  }
  const totalRow = overview.addRow([
    '',
    'TỔNG DỰ ÁN',
    input.works.filter((w) => w.work.counts).reduce((sum, w) => sum + w.work.weight, 0),
    '',
    total.progress,
  ])
  totalRow.font = { bold: true }
  totalRow.getCell(3).numFmt = PERCENT_FORMAT
  totalRow.getCell(5).numFmt = PERCENT_FORMAT

  overview.getColumn(1).width = 10
  overview.getColumn(2).width = 24
  overview.getColumn(3).width = 12
  overview.getColumn(4).width = 18
  for (let i = 0; i < widestBlock; i += 1) {
    overview.getColumn(FIXED.length + 1 + i * 2).width = 14
    overview.getColumn(FIXED.length + 2 + i * 2).width = 13
  }
  overview.getColumn(FIXED.length + widestBlock * 2 + 1).width = 12
  overview.getColumn(FIXED.length + widestBlock * 2 + 2).width = 12
  // No frozen band: the header repeats per block, so there is no one row to
  // pin. Rules and tints as before.
  ruleSheet(overview, (n) => headerRows.has(n))
  // Built and then dropped for a single-deck export, rather than skipped: the
  // blocks are computed above either way, and one path through this function
  // is worth an Overview that is never written out.
  if (input.scope === 'deck') wb.removeWorksheet(overview.id)

  // One sheet per deck, between Overview and Plan: the row-level evidence
  // behind the figures above, in the order the decks are laid out on the
  // platform.
  const taken = new Set<string>(['Overview', 'Plan'])
  for (const entry of input.decks) {
    const sheet = wb.addWorksheet(sheetNameFor(entry.deck.code, taken))

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

    /**
     * The `Dashboard` sheet's rows, once per work the deck is in (RPT-27):
     * the deck's weight in that work, then its coats with m², % Total Deck and
     * % Progress. Then, when there are several, the deck's tổng hợp -- with one
     * work the deck figure IS the work's, and a line repeating it is a second
     * number to keep in step for nothing.
     */
    const views = input.works
      .filter((m) => m.work.kind === 'bays')
      .flatMap((m) => {
        const view = m.decks.find((d) => d.deck.id === entry.deck.id)
        return view ? [{ work: m.work, view }] : []
      })
    if (views.length === 0) {
      sheet.addRow(['Sàn này chưa thuộc công việc nào'])
      sheet.lastRow!.font = { italic: true, ...GREY_FONT }
      sheet.addRow([])
    }
    for (const { work, view } of views) {
      const progress = computeDeckProgress(view.deck, view.stages)
      const title = sheet.addRow(['Công việc', work.name, 'Trọng số sàn', view.weight])
      title.font = { bold: true }
      title.getCell(4).numFmt = PERCENT_FORMAT
      const deckStageNames = view.stages.map((st: { name: string }) => st.name)
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
    }
    if (views.length > 1) {
      const summary = summariseDeck(entry.deck.id, input.works)
      const row = sheet.addRow(['% Progress sàn · tổng hợp', summary.progress])
      row.font = { bold: true }
      row.getCell(2).numFmt = PERCENT_FORMAT
      sheet.addRow([])
    }

    // One row per stage change, not per bay (Feedback Rv1, item 8): "100 ô,
    // full 4 lớp = 400 hàng". The note rides on the row of the change it
    // explains, which is the whole reason it can be a single column. The work
    // sits beside the bay: one bay moves in several works now.
    const listHeader = sheet.addRow([
      'Mã ô', 'Diện tích (m²)', 'Công việc', 'Công đoạn', 'Cập nhật lúc', 'Bởi', 'Ghi chú',
    ])
    listHeader.font = { bold: true }
    sheet.getColumn(1).width = 12
    sheet.getColumn(2).width = 15
    sheet.getColumn(3).width = 18
    sheet.getColumn(4).width = 18
    sheet.getColumn(5).width = 22
    sheet.getColumn(6).width = 20
    sheet.getColumn(7).width = 40
    for (const ev of buildEventRows(entry)) {
      const row = sheet.addRow([
        ev.code, ev.areaM2, ev.workName, ev.stageName, toVNExcelDate(ev.at) ?? '', ev.byName ?? '', ev.note,
      ])
      row.getCell(2).numFmt = AREA_FORMAT
      row.getCell(5).numFmt = DATETIME_FORMAT
      row.getCell(7).alignment = { wrapText: true, vertical: 'top' }
    }

    // Frozen at the listing header, and filterable: four hundred updates is a
    // list somebody scrolls looking for one bay, and a header that scrolls
    // away leaves seven unlabelled columns.
    sheet.views = [{ state: 'frozen', ySplit: listHeader.number }]

    /*
      Anchored BELOW the freeze line, not above it.

      They used to sit at row 1, inside the frozen band -- and a 380px image in
      a band a few rows tall is clipped at the split, so scrolling tore the
      drawing in half and left the ring floating over the data. Excel does not
      grow a frozen pane to fit a picture.

      Below the split and to the right of the seven data columns they scroll
      with the list, are never clipped, and have the whole width of the sheet
      to be legible in: at 520px the drawing was something you had to zoom into
      to read a bay code off.
    */
    const pictures = input.images?.[entry.deck.id]
    if (pictures?.drawingPng) {
      const id = wb.addImage({ base64: pictures.drawingPng, extension: 'png' })
      const w = 900
      const aspect = pictures.drawingAspect
      sheet.addImage(id, {
        // Column H (zero-based 7): G is the note now, and a picture over a
        // data column hides whatever is written there.
        tl: { col: 7, row: listHeader.number },
        ext: { width: w, height: aspect && aspect > 0 ? Math.round(w * aspect) : 660 },
      })
    }
    if (pictures?.piePng) {
      const id = wb.addImage({ base64: pictures.piePng, extension: 'png' })
      sheet.addImage(id, {
        // Clear of the drawing's 900px, so the two cannot overlap however wide
        // the reader's columns are.
        tl: { col: 20, row: listHeader.number },
        // 880x520 on the canvas -- the ring plus its key. Sized to that ratio
        // so the key does not come out squashed against the wedges it names.
        ext: { width: 748, height: 442 },
      })
    }
    sheet.autoFilter = {
      from: { row: listHeader.number, column: 1 },
      to: { row: sheet.rowCount, column: 7 },
    }
    listHeader.eachCell({ includeEmpty: true }, (c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    })
  }

  // Mirrors the customer's `Kế hoạch tháo GG`: where, what, unit, quantity,
  // days, the window, and a column to write in -- plus the work the coat
  // belongs to (RPT-28). `Đơn vị` is always m² here -- a constant column, kept
  // because it is one of theirs and the sheet is meant to drop into the habit
  // rather than replace it.
  const plan = wb.addWorksheet('Plan')
  plan.columns = [
    { header: 'Sàn', key: 'deck', width: 24 },
    { header: 'Vị trí tháo GG', key: 'zone', width: 22 },
    { header: 'Công việc', key: 'work', width: 18 },
    { header: 'Công đoạn', key: 'stage', width: 20 },
    { header: 'Đơn vị', key: 'unit', width: 9 },
    { header: 'Khối lượng', key: 'area', width: 14, style: { numFmt: AREA_FORMAT } },
    { header: 'Số ngày', key: 'days', width: 10 },
    { header: 'Bắt đầu', key: 'start', width: 14, style: { numFmt: DATE_FORMAT } },
    { header: 'Kết thúc', key: 'finish', width: 14, style: { numFmt: DATE_FORMAT } },
    { header: 'Ghi chú', key: 'note', width: 28 },
  ]

  for (const row of buildPlanRows(input.decks, input.works)) {
    plan.addRow({
      deck: row.deckName,
      zone: row.zoneName,
      work: row.workName,
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

/** "50,00%" for a block title -- text, since it sits inside a sentence. */
function formatPercentText(ratio: number): string {
  return `${(ratio * 100).toFixed(2).replace('.', ',')}%`
}

/** The filename the admin will be looking at in a folder of these next year. */
export function reportFileName(projectCode: string, today: string): string {
  return `tien-do-${projectCode}-${today}.xlsx`
}
