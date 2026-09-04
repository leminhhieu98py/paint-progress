import type { Worksheet } from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildReportWorkbook, reportFileName, sheetNameFor, type ReportInput } from './reportXlsx'
import type { DeckReportInput } from '../domain/report'
import type { Cell, Work, WorkModel } from '../domain/types'

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.4 },
  { id: 's2', seq: 2, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]
const TG_STAGES = [{ id: 't1', seq: 1, name: 'Tháo giáo lửng', color: '#8B5CF6', weight: 1 }]

const bay = (id: string, code: string, areaM2: number, stageId: string | null): Cell => ({
  id, code, x: 0, y: 0, w: 0, h: 0, areaM2, stageId, note: '',
})
const CD_META = { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000 }
const work = (
  id: string, seq: number, name: string, kind: Work['kind'], weight: number, over: Partial<Work> = {},
): Work => ({ id, projectId: 'p1', seq, name, kind, weight, counts: true, manualProgress: 0, ...over })

/** One work over one deck: 500 of 1000 m² at the last of two coats -> 50%. */
const SON: WorkModel = {
  work: work('w1', 1, 'Sơn', 'bays', 1),
  decks: [{ deck: { ...CD_META, cells: [bay('c1', 'R1C1', 500, 's2')] }, stages: STAGES, weight: 1 }],
}
const DECK: DeckReportInput = {
  deck: { ...CD_META, cells: [bay('c1', 'R1C1', 500, null)] },
  zones: [{
    id: 'z1', name: 'Khu A', stageId: 's2', color: null,
    startDate: '2026-09-01', finishDate: '2026-09-07', cellIds: ['c1'],
  }],
  events: [],
}
const BASE: ReportInput = { projectName: 'BB1', projectCode: 'BB1', works: [SON], decks: [DECK] }

/** Sơn W .6 and Tháo giáo W .4 over the same deck: .6·.5 + .4·.5 = 50,00% either way. */
const TG: WorkModel = {
  work: work('w2', 2, 'Tháo giáo', 'bays', 0.4),
  decks: [{ deck: { ...CD_META, cells: [bay('c1', 'R1C1', 500, 't1')] }, stages: TG_STAGES, weight: 1 }],
}
const TWO_WORKS: ReportInput = {
  ...BASE, works: [{ ...SON, work: { ...SON.work, weight: 0.6 } }, TG],
}

const EVENT = {
  id: 1, cellCode: 'R1C1', cellAreaM2: 500, workName: 'Sơn', toStageName: 'Blast + Coat 1',
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

/** 1-based number of the first row whose cell in `col` reads `text`; 0 when none. */
function rowWhere(sheet: Worksheet, col: number, text: string | RegExp): number {
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    const v = sheet.getRow(r).getCell(col).value
    const s = v === null || v === undefined ? '' : String(v)
    if (typeof text === 'string' ? s === text : text.test(s)) return r
  }
  return 0
}

describe('buildReportWorkbook', () => {
  it('writes Overview, one sheet per deck, then Plan', async () => {
    const wb = await readBack(await buildReportWorkbook(BASE))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Overview', 'CD', 'Plan'])
  })

  it('heads each work block the way the customer\'s own Dashboard does', async () => {
    // A title naming the work and its weight, then three rows: the coat weight
    // over each stage, the stage name spanning its pair, then m² / % Total Deck
    // under it. This file lands beside the workbook it replaces, in front of
    // people who have read that layout for months, and the weights row is the
    // only thing on the sheet that explains how % Progress was arrived at.
    const wb = await readBack(await buildReportWorkbook(BASE))
    const ov = wb.getWorksheet('Overview')!

    const title = rowWhere(ov, 1, /^Sơn · trọng số/)
    expect(title).toBe(1)
    expect(String(ov.getRow(title).getCell(1).value)).toMatch(/tính vào tổng/)

    const weights = (ov.getRow(title + 1).values as (number | undefined)[]).filter((v) => v !== undefined)
    expect(weights).toEqual([0.4, 0.6])

    const names = ov.getRow(title + 2).values as string[]
    expect(names.slice(1, 5)).toEqual(['Mã', 'Sàn', 'Tỉ trọng', 'Diện tích (m²)'])
    expect(names).toContain('Blast + Coat 1')
    expect(names).toContain('Tháo giáo')
    expect(names).toContain('% Progress')
    expect(names).toContain('% Remain')

    // Only the stage columns: the four fixed ones are merged down, so they
    // report their own value on the unit row as well.
    const units = (ov.getRow(title + 3).values as string[]).slice(5, 9)
    expect(units).toEqual(['m²', '% Total Deck', 'm²', '% Total Deck'])
  })

  it('rules every cell and tints each block\'s header, like the sheet it replaces', async () => {
    const wb = await readBack(await buildReportWorkbook(BASE))
    const ov = wb.getWorksheet('Overview')!
    expect(ov.getRow(5).getCell(2).border).toBeDefined()
    expect(ov.getRow(3).getCell(2).fill).toBeDefined()
  })

  it('writes percentages as numbers with a percent format, not as text', async () => {
    // The client sorts and re-totals these columns. A pre-formatted string
    // sorts as text and sums to zero, and looks completely normal doing it.
    const wb = await readBack(await buildReportWorkbook(BASE))
    const ov = wb.getWorksheet('Overview')!
    const names = rowWhere(ov, 1, 'Mã')
    const progressCol = (ov.getRow(names).values as string[]).indexOf('% Progress')
    const cell = ov.getRow(names + 2).getCell(progressCol)
    // 500 of 1000 reached the last of two stages: .4*.5 + .6*.5 = .5
    expect(typeof cell.value).toBe('number')
    expect(cell.value as number).toBeCloseTo(0.5, 12)
    expect(cell.numFmt).toBe('0.00%')
  })

  it('closes each block with the work subtotal, and the sheet with TỔNG DỰ ÁN = P', async () => {
    const wb = await readBack(await buildReportWorkbook(TWO_WORKS))
    const ov = wb.getWorksheet('Overview')!

    const sonSub = rowWhere(ov, 2, 'Cộng · Sơn')
    const tgSub = rowWhere(ov, 2, 'Cộng · Tháo giáo')
    expect(sonSub).toBeGreaterThan(0)
    expect(tgSub).toBeGreaterThan(sonSub)
    // Tháo giáo's block has its own header, below Sơn's subtotal.
    expect(rowWhere(ov, 1, /^Tháo giáo · trọng số/)).toBeGreaterThan(sonSub)

    const total = rowWhere(ov, 2, 'TỔNG DỰ ÁN')
    expect(total).toBeGreaterThan(tgSub)
    // W .6 at 50% and W .4 at 50%.
    expect(ov.getRow(total).getCell(5).value as number).toBeCloseTo(0.5, 12)
    expect(ov.getRow(total).getCell(5).numFmt).toBe('0.00%')
  })

  it('leaves a stage a deck does not declare empty rather than zero', async () => {
    const other = {
      deck: { id: 'd2', code: 'MD', name: 'Main Deck', totalAreaM2: 1000, cells: [] },
      stages: [{ id: 'x1', seq: 1, name: 'Sơn chống trượt', color: '#eb2f96', weight: 1 }],
      weight: 0.5,
    }
    const wb = await readBack(await buildReportWorkbook({
      ...BASE,
      works: [{ ...SON, decks: [{ ...SON.decks[0], weight: 0.5 }, other] }],
      decks: [DECK, { deck: other.deck, zones: [], events: [] }],
    }))
    const ov = wb.getWorksheet('Overview')!
    const names = rowWhere(ov, 1, 'Mã')
    // The stage name spans two columns on the names row; its m² column is the first.
    const col = (ov.getRow(names).values as string[]).indexOf('Tháo giáo')
    const md = rowWhere(ov, 2, 'Main Deck')
    expect(ov.getRow(md).getCell(col).value).toBeNull()
  })

  it('lists the manual works with their weight and figure, greyed when they do not count', async () => {
    const wb = await readBack(await buildReportWorkbook({
      ...BASE,
      works: [
        { ...SON, work: { ...SON.work, weight: 0.7 } },
        { work: work('w3', 2, 'Chứng từ', 'manual', 0.3, { manualProgress: 0.5 }), decks: [] },
        { work: work('w4', 3, 'Marking', 'manual', 0, { counts: false, manualProgress: 1 }), decks: [] },
      ],
    }))
    const ov = wb.getWorksheet('Overview')!

    const paper = rowWhere(ov, 2, 'Chứng từ')
    expect(ov.getRow(paper).getCell(3).value).toBe(0.3)
    expect(ov.getRow(paper).getCell(4).value).toBe('Nhập tay')
    expect(ov.getRow(paper).getCell(5).value).toBe(0.5)

    const marking = rowWhere(ov, 2, 'Marking')
    expect(ov.getRow(marking).getCell(3).value).toBe('—')
    expect(ov.getRow(marking).getCell(4).value).toBe('Không tính vào tổng')
    expect(ov.getRow(marking).getCell(5).value).toBe(1)

    // .7·.5 + .3·.5; Marking is on the sheet and out of the total.
    const total = rowWhere(ov, 2, 'TỔNG DỰ ÁN')
    expect(ov.getRow(total).getCell(5).value as number).toBeCloseTo(0.5, 12)
  })

  it('lays the plan pictures under the table, each under a title naming deck, work and coat', async () => {
    // Feedback Rv2 item 10: Linh wants the layout in the sheet she prints.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const wb = await readBack(await buildReportWorkbook({
      ...BASE,
      planImages: [
        { deckName: 'Cellar Deck', workName: 'Sơn', lastStageName: 'Tháo giáo', png, aspect: 0.5 },
        { deckName: 'Cellar Deck', workName: 'Tháo giáo', lastStageName: 'Tháo giáo lửng', png, aspect: 0.5 },
      ],
    }))
    const plan = wb.getWorksheet('Plan')!
    expect(plan.getImages()).toHaveLength(2)
    const first = rowWhere(plan, 1, 'Cellar Deck · Sơn · lớp cuối: Tháo giáo')
    const second = rowWhere(plan, 1, 'Cellar Deck · Tháo giáo · lớp cuối: Tháo giáo lửng')
    expect(first).toBeGreaterThan(2)
    // The second title sits below the first picture: 900 x 0.5 = 450px, 23 rows.
    expect(second - first).toBeGreaterThanOrEqual(24)
    const anchors = plan.getImages().map((i) => i.range.tl.nativeRow).sort((a, b) => a - b)
    expect(anchors[0]).toBe(first)
  })

  it('writes no picture rows when no plan picture was supplied', async () => {
    const wb = await readBack(await buildReportWorkbook(BASE))
    expect(wb.getWorksheet('Plan')!.getImages()).toHaveLength(0)
  })

  it('mirrors the customer\'s Kế hoạch tháo GG columns, plus the work', async () => {
    const wb = await readBack(await buildReportWorkbook(BASE))
    const plan = wb.getWorksheet('Plan')!
    expect((plan.getRow(1).values as string[]).filter(Boolean)).toEqual([
      'Sàn', 'Khu vực', 'Công việc', 'Công đoạn', 'Đơn vị', 'Khối lượng',
      'Số ngày', 'Bắt đầu', 'Kết thúc', 'Ghi chú',
    ])

    const row = plan.getRow(2)
    expect(row.getCell(1).value).toBe('Cellar Deck')
    expect(row.getCell(2).value).toBe('Khu A')
    expect(row.getCell(3).value).toBe('Sơn')
    expect(row.getCell(4).value).toBe('Tháo giáo')
    expect(row.getCell(5).value).toBe('m²')
    expect(row.getCell(7).value).toBe(7)
  })

  it('writes the planned dates as dates, on the day they name', async () => {
    // Text before this: it read correctly and sorted as strings, so a client
    // sorting the plan by start date got alphabetical order. A Date is the fix,
    // and anchoring it at local noon is what keeps it on the right DAY -- from
    // midnight, the host's offset moves it either side.
    const wb = await readBack(await buildReportWorkbook(BASE))
    const row = wb.getWorksheet('Plan')!.getRow(2)

    const start = row.getCell(8).value as Date
    expect(start).toBeInstanceOf(Date)
    expect(`${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`).toBe('2026-9-1')
    const finish = row.getCell(9).value as Date
    expect(`${finish.getFullYear()}-${finish.getMonth() + 1}-${finish.getDate()}`).toBe('2026-9-7')
  })

  it('produces a workbook for a project with no works and no decks at all', async () => {
    const wb = await readBack(await buildReportWorkbook({
      projectName: 'BB1', projectCode: 'BB1', works: [], decks: [],
    }))
    // An export that throws on an empty project is an export the admin cannot
    // use to prove it is empty.
    const ov = wb.getWorksheet('Overview')!
    expect(rowWhere(ov, 2, 'TỔNG DỰ ÁN')).toBeGreaterThan(0)
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
  const sheetOf = async (over: Partial<ReportInput> = {}) => {
    const wb = await readBack(await buildReportWorkbook({ ...BASE, ...over }))
    return wb.getWorksheet('CD')!
  }

  it('heads the sheet with the deck and its declared area', async () => {
    const sheet = await sheetOf()
    expect(sheet.getRow(1).getCell(1).value).toBe('Cellar Deck')
    expect(sheet.getRow(2).getCell(2).value).toBe(1000)
  })

  it('carries the spec block for the deck\'s one work, and its percentage', async () => {
    const sheet = await sheetOf()
    const title = rowWhere(sheet, 1, 'Công việc')
    expect(sheet.getRow(title).getCell(2).value).toBe('Sơn')
    // The next rows: stage header, m², % Total Deck, % Progress.
    expect(sheet.getRow(title + 1).values).toContain('Tháo giáo')
    expect(sheet.getRow(title + 2).getCell(1).value).toBe('m²')
    expect(sheet.getRow(title + 3).getCell(1).value).toBe('% Total Deck')
    expect(sheet.getRow(title + 4).getCell(1).value).toBe('% Progress')
    expect(sheet.getRow(title + 4).getCell(2).value as number).toBeCloseTo(0.5, 12)
    // One work: the deck figure IS the work's, so no tổng hợp line repeats it.
    expect(rowWhere(sheet, 1, /tổng hợp/)).toBe(0)
  })

  it('repeats the spec block per work the deck is in, then gives the deck tổng hợp', async () => {
    const sheet = await sheetOf(TWO_WORKS)
    const son = rowWhere(sheet, 2, 'Sơn')
    const tg = rowWhere(sheet, 2, 'Tháo giáo')
    expect(son).toBeGreaterThan(0)
    expect(tg).toBeGreaterThan(son)
    // Each block names the deck's weight in that work.
    expect(sheet.getRow(son).getCell(3).value).toBe('Trọng số sàn')
    expect(sheet.getRow(son).getCell(4).value).toBe(1)
    expect(sheet.getRow(tg + 1).values).toContain('Tháo giáo lửng')
    expect(sheet.getRow(tg + 4).getCell(2).value as number).toBeCloseTo(0.5, 12)

    const total = rowWhere(sheet, 1, '% Progress sàn · tổng hợp')
    expect(total).toBeGreaterThan(tg)
    expect(sheet.getRow(total).getCell(2).value as number).toBeCloseTo(0.5, 12)
  })

  it('lists every stage change with its bay, area, work, coat, time, author and note', async () => {
    // One row per update, not per bay (Feedback Rv1, item 8): "100 ô, full 4
    // lớp = 400 hàng". The note rides on the row of the change it explains.
    const sheet = await sheetOf({
      decks: [{
        ...DECK,
        events: [
          EVENT,
          { ...EVENT, id: 2, toStageName: 'Tháo giáo', at: '2026-08-21T10:00:00+00:00', note: '' },
        ],
        userNames: { u1: 'Nguyễn Văn A' },
      }],
    })
    const header = rowWhere(sheet, 1, 'Mã ô')
    expect((sheet.getRow(header).values as string[]).slice(1, 8)).toEqual([
      'Mã ô', 'Diện tích (m²)', 'Công việc', 'Công đoạn', 'Cập nhật lúc', 'Bởi', 'Ghi chú',
    ])
    const first = sheet.getRow(header + 1)
    expect(first.getCell(1).value).toBe('R1C1')
    expect(first.getCell(2).value).toBe(500)
    expect(first.getCell(3).value).toBe('Sơn')
    expect(first.getCell(4).value).toBe('Blast + Coat 1')
    expect(first.getCell(5).value).toBeInstanceOf(Date)
    expect(first.getCell(6).value).toBe('Nguyễn Văn A')
    expect(first.getCell(7).value).toBe('Bắt đầu')
    const second = sheet.getRow(header + 2)
    expect(second.getCell(4).value).toBe('Tháo giáo')
    expect(String(second.getCell(7).value ?? '')).toBe('')
    expect(sheet.getRow(header + 3).getCell(1).value).toBeNull()
  })

  it('filters over all seven columns and anchors the drawing clear of them', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const sheet = await sheetOf({
      decks: [{ ...DECK, events: [EVENT] }],
      images: { d1: { drawingPng: png, piePng: null } },
    })
    // ExcelJS reads the filter back as a range string.
    const filter = sheet.autoFilter as unknown
    if (typeof filter === 'string') expect(filter).toMatch(/^A\d+:G\d+$/)
    else expect((filter as { to: { column: number } }).to.column).toBe(7)
    // Column G is data now; the picture starts at H (zero-based anchor 7).
    const [drawing] = sheet.getImages()
    expect(drawing.range.tl.nativeCol).toBe(7)
  })

  it('discloses a prorated area, and says nothing when it was measured', async () => {
    // Spec §9. Somebody pricing a variation has to know whether a bay's area was
    // measured off the drawing or divided out of a declared total.
    const prorated = await sheetOf({ decks: [{ ...DECK, areaSource: 'prorated' as const }] })
    expect(String(prorated.getRow(3).getCell(2).value)).toMatch(/chia theo tỉ lệ/)

    const measured = await sheetOf({ decks: [{ ...DECK, areaSource: 'guides' as const }] })
    expect(measured.getRow(3).getCell(1).value).toBeNull()
  })

  it('embeds the drawing and the pie when the caller supplies them', async () => {
    // A 1x1 transparent PNG -- enough to prove it reaches the workbook.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const sheet = await sheetOf({ images: { d1: { drawingPng: png, piePng: png } } })
    expect(sheet.getImages()).toHaveLength(2)
  })

  it('still writes the deck sheet when no image could be rendered', async () => {
    // A deck with no drawing, or one whose render failed, keeps its numbers.
    const sheet = await sheetOf({ images: { d1: { drawingPng: null, piePng: null } } })
    expect(sheet.getRow(1).getCell(1).value).toBe('Cellar Deck')
    expect(sheet.getImages()).toHaveLength(0)
  })

  it('says so on a deck no work covers, and still lists its changes', async () => {
    const sheet = await sheetOf({ works: [] })
    expect(rowWhere(sheet, 1, 'Sàn này chưa thuộc công việc nào')).toBeGreaterThan(0)
    expect(rowWhere(sheet, 1, 'Mã ô')).toBeGreaterThan(0)
  })
})

describe('a single-deck export', () => {
  it('omits the Overview sheet, keeping the deck and its plan', async () => {
    // The tablet exports the deck tab that is open (Feedback Rv1, item 6). A
    // one-row Overview would print that deck at 100% weight and call it the
    // project total, which is a number nobody should be handed.
    const wb = await readBack(await buildReportWorkbook({ ...BASE, scope: 'deck' }))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['CD', 'Plan'])
  })

  it('keeps the Overview when the scope is the project, or unstated', async () => {
    const wb = await readBack(await buildReportWorkbook({ ...BASE, scope: 'project' }))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Overview', 'CD', 'Plan'])
  })
})
