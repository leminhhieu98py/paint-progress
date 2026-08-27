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

  it('gives every stage two columns, area then share', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const header = wb.getWorksheet('Overview')!.getRow(1).values as string[]
    expect(header).toContain('Blast + Coat 1 (m²)')
    expect(header).toContain('Blast + Coat 1 (%)')
    expect(header).toContain('Tháo giáo (m²)')
    expect(header).toContain('% Progress')
    expect(header).toContain('% Remain')
  })

  it('writes percentages as numbers with a percent format, not as text', async () => {
    // The client sorts and re-totals these columns. A pre-formatted string
    // sorts as text and sums to zero, and looks completely normal doing it.
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const sheet = wb.getWorksheet('Overview')!
    const progressCol = (sheet.getRow(1).values as string[]).indexOf('% Progress')
    const cell = sheet.getRow(2).getCell(progressCol)
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
    expect(sheet.getRow(3).getCell(2).value).toBe('TỔNG DỰ ÁN')
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
    const col = (sheet.getRow(1).values as string[]).indexOf('Tháo giáo (m²)')
    // Row 3 is Main Deck, which has no Tháo giáo in its spec.
    expect(sheet.getRow(3).getCell(col).value).toBeNull()
  })

  it('writes each zone to the Plan sheet with its dates as date-only strings', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [DECK],
    }))
    const row = wb.getWorksheet('Plan')!.getRow(2)
    expect(row.getCell(1).value).toBe('Cellar Deck')
    expect(row.getCell(2).value).toBe('Khu A')
    expect(row.getCell(3).value).toBe('Tháo giáo')
    expect(row.getCell(5).value).toBe(7)
    // Strings, not Dates: a Date carries a timezone these values do not have,
    // and renders every planned start a day early west of Greenwich.
    expect(row.getCell(6).value).toBe('2026-09-01')
    expect(row.getCell(7).value).toBe('2026-09-07')
  })

  it('produces a workbook for a project with no decks at all', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', decks: [],
    }))
    // Just the header and the rollup -- an export that throws on an empty
    // project is an export the admin cannot use to prove it is empty.
    expect(wb.getWorksheet('Overview')!.getRow(2).getCell(2).value).toBe('TỔNG DỰ ÁN')
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

  it('lists every bay with its area, stage and who touched it last', async () => {
    const withAudit = {
      ...DECK,
      audit: { c1: { updatedAt: '2026-08-20T10:00:00+00:00', updatedBy: 'u1' } },
      userNames: { u1: 'Nguyễn Văn A' },
    }
    const sheet = await sheetOf([withAudit])
    // The listing header follows a blank row after the spec block.
    const headerRow = sheet.getRow(9)
    expect(headerRow.values).toContain('Mã ô')
    expect(headerRow.values).toContain('Bởi')
    const first = sheet.getRow(10)
    expect(first.getCell(1).value).toBe('R1C1')
    expect(first.getCell(3).value).toBe('Tháo giáo')
    expect(first.getCell(5).value).toBe('Nguyễn Văn A')
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
