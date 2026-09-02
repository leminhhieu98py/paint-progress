import { describe, expect, it } from 'vitest'
import { buildReportWorkbook, reportFileName, sheetNameFor } from './reportXlsx'
import type { DeckReportInput } from '../domain/report'

const DECK: DeckReportInput = {
  deck: {
    id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000,
    cells: [
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0, h: 0, areaM2: 500, stageId: 's2' },
    ],
  },
  stages: [
    { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.4 },
    { id: 's2', seq: 2, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
  ],
  zones: [{
    id: 'z1', name: 'Khu A', stageId: 's2',
    startDate: '2026-09-01', finishDate: '2026-09-07', cellIds: ['c1'],
  }],
  events: [],
}

const EVENT = {
  id: 1, cellCode: 'R1C1', cellAreaM2: 500, workName: 'Công việc chính', toStageName: 'Blast + Coat 1',
  at: '2026-08-20T10:00:00+00:00', byId: 'u1', note: 'Bắt đầu',
  reportNote: null, reportHidden: false,
}

/** Reads the produced file back through ExcelJS, so the assertions are about a
 *  real workbook rather than about the calls made to build one. */
async function readBack(blob: Blob) {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  return wb
}

describe('buildReportWorkbook', () => {
  it('writes Overview, one sheet per deck, then Plan', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Overview', 'CD', 'Plan'])
  })

  it('heads the Overview the way the customer\'s own Dashboard does', async () => {
    // Three rows: the weight over each stage, the stage name spanning its pair,
    // then m² / % Total Deck under it. Flat headers were readable and wrong for
    // the job -- this file lands beside the workbook it replaces, in front of
    // people who have read that layout for months, and the weights row is the
    // only thing on the sheet that explains how % Progress was arrived at.
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const ov = wb.getWorksheet('Overview')!

    const names = ov.getRow(2).values as string[]
    expect(names).toContain('Blast + Coat 1')
    expect(names).toContain('Tháo giáo')
    expect(names).toContain('% Progress')
    expect(names).toContain('% Remain')

    // Only the stage columns: the four fixed ones are merged down from row 2,
    // so they report their own value on row 3 as well.
    const units = (ov.getRow(3).values as string[]).slice(5, 9)
    expect(units).toEqual(['m²', '% Total Deck', 'm²', '% Total Deck'])

    // The weights sit over their own stage's percentage column, as numbers.
    const weights = (ov.getRow(1).values as (number | undefined)[]).filter((v) => v !== undefined)
    expect(weights).toEqual([0.4, 0.6])
  })

  it('freezes the header and rules every cell, like the sheet it replaces', async () => {
    // A deck listing runs to two hundred rows; a column of numbers with the
    // header scrolled off is a column nobody can read.
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const ov = wb.getWorksheet('Overview')!
    expect(ov.views[0].state).toBe('frozen')
    expect(ov.getRow(4).getCell(2).border).toBeDefined()
    expect(ov.getRow(2).getCell(2).fill).toBeDefined()
  })

  it('writes percentages as numbers with a percent format, not as text', async () => {
    // The client sorts and re-totals these columns. A pre-formatted string
    // sorts as text and sums to zero, and looks completely normal doing it.
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const sheet = wb.getWorksheet('Overview')!
    const progressCol = (sheet.getRow(2).values as string[]).indexOf('% Progress')
    const cell = sheet.getRow(4).getCell(progressCol)
    // 500 of 1000 reached the last of two stages: .4*.5 + .6*.5 = .5
    expect(typeof cell.value).toBe('number')
    expect(cell.value as number).toBeCloseTo(0.5, 12)
    expect(cell.numFmt).toBe('0.00%')
  })

  it('closes the Overview with the project rollup', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const sheet = wb.getWorksheet('Overview')!
    expect(sheet.getRow(5).getCell(2).value).toBe('TỔNG DỰ ÁN')
  })

  it('leaves a stage the deck does not declare empty rather than zero', async () => {
    const other: DeckReportInput = {
      ...DECK,
      deck: { ...DECK.deck, id: 'd2', code: 'MD', name: 'Main Deck', cells: [] },
      stages: [{ id: 'x1', seq: 1, name: 'Sơn chống trượt', color: '#eb2f96', weight: 1 }],
    }
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK, other],
    }))
    const sheet = wb.getWorksheet('Overview')!
    // The stage name spans two columns on row 2; its m² column is the first.
    const col = (sheet.getRow(2).values as string[]).indexOf('Tháo giáo')
    // Row 5 is Main Deck, which has no Tháo giáo in its spec.
    expect(sheet.getRow(5).getCell(col).value).toBeNull()
  })

  it('mirrors the customer\'s Kế hoạch tháo GG columns', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const plan = wb.getWorksheet('Plan')!
    expect((plan.getRow(1).values as string[]).filter(Boolean)).toEqual([
      'Sàn', 'Vị trí tháo GG', 'Công đoạn', 'Đơn vị', 'Khối lượng',
      'Số ngày', 'Bắt đầu', 'Kết thúc', 'Ghi chú',
    ])

    const row = plan.getRow(2)
    expect(row.getCell(1).value).toBe('Cellar Deck')
    expect(row.getCell(2).value).toBe('Khu A')
    expect(row.getCell(4).value).toBe('m²')
    expect(row.getCell(6).value).toBe(7)
  })

  it('writes the planned dates as dates, on the day they name', async () => {
    // Text before this: it read correctly and sorted as strings, so a client
    // sorting the plan by start date got alphabetical order. A Date is the fix,
    // and anchoring it at local noon is what keeps it on the right DAY -- from
    // midnight, the host's offset moves it either side.
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const row = wb.getWorksheet('Plan')!.getRow(2)

    const start = row.getCell(7).value as Date
    expect(start).toBeInstanceOf(Date)
    expect(`${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`).toBe('2026-9-1')
    const finish = row.getCell(8).value as Date
    expect(`${finish.getFullYear()}-${finish.getMonth() + 1}-${finish.getDate()}`).toBe('2026-9-7')
  })

  it('produces a workbook for a project with no decks at all', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [],
    }))
    // Three header rows, then the rollup -- an export that throws on an empty
    // project is an export the admin cannot use to prove it is empty.
    expect(wb.getWorksheet('Overview')!.getRow(4).getCell(2).value).toBe('TỔNG DỰ ÁN')
  })
})

describe('reportFileName', () => {
  it('names the file by project and date', () => {
    expect(reportFileName('BB1', '2026-08-26')).toBe('tien-do-BB1-2026-08-26.xlsx')
  })
})

describe('sheetNameFor', () => {
  it('strips the characters Excel forbids in a sheet name', () => {
    // A workbook Excel refuses to open is worse than a deck called A-B.
    expect(sheetNameFor('A/B:C*D?E[F]G', new Set())).toBe('A-B-C-D-E-F-G')
  })

  it('caps the name at 31 characters', () => {
    expect(sheetNameFor('X'.repeat(60), new Set())).toHaveLength(31)
  })

  it('suffixes a name already taken, rather than producing an invalid workbook', () => {
    const taken = new Set(['CD'])
    expect(sheetNameFor('CD', taken)).toBe('CD (2)')
    expect(sheetNameFor('CD', taken)).toBe('CD (3)')
  })

  it('never collides with Overview or Plan', () => {
    const taken = new Set(['Overview', 'Plan'])
    expect(sheetNameFor('Plan', taken)).toBe('Plan (2)')
  })

  it('falls back to a name when the code is empty or all-forbidden', () => {
    expect(sheetNameFor('  ', new Set())).toBe('Deck')
  })
})

describe('per-deck sheets', () => {
  const sheetOf = async (decks: typeof DECK[], images?: Record<string, unknown>) => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks,
      images: images as never,
    }))
    return wb.getWorksheet('CD')!
  }

  it('heads the sheet with the deck and its declared area', async () => {
    const sheet = await sheetOf([DECK])
    expect(sheet.getRow(1).getCell(1).value).toBe('Cellar Deck')
    expect(sheet.getRow(2).getCell(2).value).toBe(1000)
  })

  it('carries the two-row spec table and the deck percentage', async () => {
    const sheet = await sheetOf([DECK])
    // Row 4 is the stage header, 5 the areas, 6 the ratios, 7 the total.
    expect(sheet.getRow(4).values).toContain('Tháo giáo')
    expect(sheet.getRow(5).getCell(1).value).toBe('m²')
    expect(sheet.getRow(6).getCell(1).value).toBe('% Total Deck')
    expect(sheet.getRow(7).getCell(1).value).toBe('% Progress')
    expect(sheet.getRow(7).getCell(2).value as number).toBeCloseTo(0.5, 12)
  })

  it('lists every stage change with its bay, area, coat, time, author and note', async () => {
    // One row per update, not per bay (Feedback Rv1, item 8): "100 ô, full 4
    // lớp = 400 hàng". The note rides on the row of the change it explains.
    const sheet = await sheetOf([{
      ...DECK,
      events: [
        EVENT,
        { ...EVENT, id: 2, toStageName: 'Tháo giáo', at: '2026-08-21T10:00:00+00:00', note: '' },
      ],
      userNames: { u1: 'Nguyễn Văn A' },
    }])
    // The listing header follows a blank row after the spec block.
    const headerRow = sheet.getRow(9)
    expect(headerRow.values).toEqual(
      expect.arrayContaining(['Mã ô', 'Diện tích (m²)', 'Công đoạn', 'Cập nhật lúc', 'Bởi', 'Ghi chú']),
    )
    expect(headerRow.getCell(6).value).toBe('Ghi chú')
    const first = sheet.getRow(10)
    expect(first.getCell(1).value).toBe('R1C1')
    expect(first.getCell(2).value).toBe(500)
    expect(first.getCell(3).value).toBe('Blast + Coat 1')
    expect(first.getCell(4).value).toBeInstanceOf(Date)
    expect(first.getCell(5).value).toBe('Nguyễn Văn A')
    expect(first.getCell(6).value).toBe('Bắt đầu')
    const second = sheet.getRow(11)
    expect(second.getCell(3).value).toBe('Tháo giáo')
    expect(String(second.getCell(6).value ?? '')).toBe('')
    expect(sheet.getRow(12).getCell(1).value).toBeNull()
  })

  it('filters over all six columns and anchors the drawing clear of them', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const sheet = await sheetOf(
      [{ ...DECK, events: [EVENT] }],
      { d1: { drawingPng: png, piePng: null } },
    )
    // ExcelJS reads the filter back as a range string.
    const filter = sheet.autoFilter as unknown
    if (typeof filter === 'string') expect(filter).toMatch(/^A9:F\d+$/)
    else expect((filter as { to: { column: number } }).to.column).toBe(6)
    // Column F is data now; the picture starts at G (0-based 6 -> tl.col 6 is
    // G in ExcelJS's zero-based anchor). One column further right than before.
    const [drawing] = sheet.getImages()
    expect(drawing.range.tl.nativeCol).toBe(7)
  })

  it('discloses a prorated area, and says nothing when it was measured', async () => {
    // Spec §9. Somebody pricing a variation has to know whether a bay's area was
    // measured off the drawing or divided out of a declared total.
    const prorated = await sheetOf([{ ...DECK, areaSource: 'prorated' as const }])
    expect(String(prorated.getRow(3).getCell(2).value)).toMatch(/chia theo tỉ lệ/)

    const measured = await sheetOf([{ ...DECK, areaSource: 'guides' as const }])
    expect(measured.getRow(3).getCell(1).value).toBeNull()
  })

  it('embeds the drawing and the pie when the caller supplies them', async () => {
    // A 1x1 transparent PNG -- enough to prove it reaches the workbook.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
      images: { d1: { drawingPng: png, piePng: png } },
    }))
    expect(wb.getWorksheet('CD')!.getImages()).toHaveLength(2)
  })

  it('still writes the deck sheet when no image could be rendered', async () => {
    // A deck with no drawing, or one whose render failed, keeps its numbers.
    const sheet = await sheetOf([DECK], { d1: { drawingPng: null, piePng: null } })
    expect(sheet.getRow(1).getCell(1).value).toBe('Cellar Deck')
    expect(sheet.getImages()).toHaveLength(0)
  })
})

describe('a single-deck export', () => {
  it('omits the Overview sheet, keeping the deck and its plan', async () => {
    // The tablet exports the deck tab that is open (Feedback Rv1, item 6). A
    // one-row Overview would print that deck at 100% weight and call it the
    // project total, which is a number nobody should be handed.
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK], scope: 'deck',
    }))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['CD', 'Plan'])
  })

  it('keeps the Overview when the scope is the project, or unstated', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK], scope: 'project',
    }))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Overview', 'CD', 'Plan'])
  })
})
