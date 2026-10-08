import { Workbook, type Worksheet } from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { Spool } from '../../domain/piping/types'
import type { PipingNoteEntry } from '../pipingApi/notes'
import { buildPipingReport, CHART_FAILED, pipingReportFileName, pipingReportSeries, type PipingReportInput } from './report'

/**
 * The Piping report (spec §10): the workbook's sheets, cells and formats,
 * read back with ExcelJS. Chart images arrive as PNGs from the caller
 * (`chartImage.ts`); here they are a 1x1 PNG, or the failure marker.
 */

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const utc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

let nextSeq = 1
const spool = (over: Partial<Spool> = {}): Spool => {
  const seq = over.seq ?? nextSeq++
  return {
    id: `s${seq}`,
    seq,
    spoolNo: `SP-${seq}`,
    lineNo: 'L1',
    insuType: 'HC',
    drawingNo: 'D1',
    testPackageNo: 'TP1',
    paintingSystem: 'BD-02B',
    extra: {},
    phPlan: null,
    ihPlan: null,
    iwPlan: null,
    phActual: null,
    ihActual: null,
    iwActual: null,
    ...over,
  }
}

const note = (over: Partial<PipingNoteEntry>): PipingNoteEntry => ({
  id: 'n1',
  target: 'reinstatement_day',
  day: '2026-09-30',
  spoolId: null,
  body: 'Mưa, dừng thi công',
  authorId: 'u1',
  createdAt: '2026-09-30T03:15:00Z',
  updatedBy: null,
  updatedAt: null,
  authorName: 'Nguyễn Văn A',
  updatedByName: null,
  ...over,
})

function input(over: Partial<PipingReportInput> = {}): PipingReportInput {
  return {
    project: { name: 'Đại Hùng', code: 'DH' },
    settings: { weekStartDate: '2026-09-28', totalTestPacks: 100, lateThresholdDays: 7 },
    mode: 'day',
    unit: 'spoolNo',
    todayKey: '2026-10-02',
    reinstatement: {
      plan: [
        { day: '2026-09-30', planQty: 10 },
        { day: '2026-10-01', planQty: 5 },
        { day: '2026-10-05', planQty: 7 },
      ],
      actual: [
        { day: '2026-09-30', qty: 4 },
        { day: '2026-10-01', qty: 3 },
        { day: '2026-10-01', qty: 1 },
      ],
    },
    manpower: {
      groups: [
        { id: 'g2', name: 'Insulation', sort: 2, hidden: false },
        { id: 'g1', name: 'Reinstatement', sort: 1, hidden: false },
      ],
      plan: [
        { groupId: 'g1', day: '2026-09-30', value: 4 },
        { groupId: 'g2', day: '2026-09-30', value: 6 },
        { groupId: 'g1', day: '2026-10-01', value: 2 },
      ],
      actual: [
        { groupId: 'g1', day: '2026-09-30', value: 3 },
        { groupId: 'g1', day: '2026-10-01', value: 1.5 },
      ],
    },
    spools: [
      spool({ id: 'a', seq: 1, spoolNo: 'SP-A', lineNo: 'L1', testPackageNo: 'TP2', phPlan: '2026-09-01', phActual: '2026-09-20' }),
      spool({ id: 'b', seq: 2, spoolNo: 'SP-B', lineNo: 'L2', testPackageNo: 'TP1', phPlan: '2026-09-30', phActual: '2026-09-30', ihPlan: '2026-09-01' }),
    ],
    includeNotes: false,
    notes: [],
    charts: {},
    ...over,
  }
}

async function open(blob: Blob): Promise<Workbook> {
  const wb = new Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  return wb
}

const sheet = (wb: Workbook, name: string): Worksheet => {
  const ws = wb.getWorksheet(name)
  if (!ws) throw new Error(`no sheet ${name}`)
  return ws
}

const rowValues = (ws: Worksheet, n: number): unknown[] => {
  const row = ws.getRow(n)
  const out: unknown[] = []
  for (let c = 1; c <= ws.columnCount; c += 1) out.push(row.getCell(c).value ?? null)
  return out
}

const headerOf = (ws: Worksheet) => rowValues(ws, 1)

describe('buildPipingReport (spec §10)', () => {
  it('writes the sheets in order, without Ghi chú when notes are not included', async () => {
    const wb = await open(await buildPipingReport(input()))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tóm tắt', 'Reinstatement', 'Manpower', 'Insulation', 'Spool trễ'])
  })

  it('adds Ghi chú only when notes are included (admin)', async () => {
    const notes = [
      note({}),
      note({ id: 'n2', target: 'spool', day: null, spoolId: 'b', body: 'Thiếu bảo ôn', createdAt: '2026-10-01T10:00:00Z' }),
      note({ id: 'n3', target: 'manpower_day', day: '2026-10-01', body: 'Thiếu người', authorName: null }),
    ]
    const without = await open(await buildPipingReport(input({ notes, includeNotes: false })))
    expect(without.getWorksheet('Ghi chú')).toBeUndefined()

    const wb = await open(await buildPipingReport(input({ notes, includeNotes: true })))
    expect(wb.worksheets.map((w) => w.name)).toContain('Ghi chú')
    const ws = sheet(wb, 'Ghi chú')
    expect(headerOf(ws)).toEqual(['Mục', 'Ngày', 'Spool', 'Nội dung', 'Người viết', 'Thời gian'])
    // 03:15 UTC is 10:15 in Vietnam: the cell holds the wall clock (toVNExcelDate).
    expect(rowValues(ws, 2)).toEqual(['Reinstatement', utc('2026-09-30'), null, 'Mưa, dừng thi công', 'Nguyễn Văn A', new Date('2026-09-30T10:15:00Z')])
    expect(rowValues(ws, 3)).toEqual(['Spool', null, 'SP-B', 'Thiếu bảo ôn', 'Nguyễn Văn A', new Date('2026-10-01T17:00:00Z')])
    expect(rowValues(ws, 4).slice(0, 5)).toEqual(['Manpower', utc('2026-10-01'), null, 'Thiếu người', null])
    expect(ws.getCell('B2').numFmt).toBe('dd/mm/yyyy')
    expect(ws.getCell('F2').numFmt).toBe('hh:mm:ss dd/mm/yyyy')
  })

  it('Tóm tắt: project, export day, view, unit, Reinstatement x/total %, Manpower averages, Insulation per milestone', async () => {
    const wb = await open(await buildPipingReport(input({ mode: 'week', unit: 'lineNo' })))
    const ws = sheet(wb, 'Tóm tắt')
    expect(headerOf(ws)).toEqual(['Mục', 'Giá trị', 'Tổng', '%'])
    const rows = Array.from({ length: ws.rowCount - 1 }, (_, i) => rowValues(ws, i + 2))
    const byLabel = new Map(rows.map((r) => [r[0], r.slice(1)]))
    expect(byLabel.get('Dự án')).toEqual(['Đại Hùng (DH)', null, null])
    expect(byLabel.get('Ngày xuất')).toEqual([utc('2026-10-02'), null, null])
    expect(byLabel.get('Chế độ xem')).toEqual(['Tuần', null, null])
    expect(byLabel.get('Đơn vị đếm Insulation')).toEqual(['LineNo', null, null])
    expect(byLabel.get('Reinstatement (TestPack)')).toEqual([8, 100, 0.08])
    // Per group, the mean of its days with a value up to today, summed: plan (4+2)/2 + 6 = 9, actual (3+1.5)/2 = 2.25.
    expect(byLabel.get('Manpower – Plan trung bình đến hôm nay')).toEqual([9, null, null])
    expect(byLabel.get('Manpower – Actual trung bình đến hôm nay')).toEqual([2.25, null, null])
    // LineNo: two lines, both reached PH; none reached IH or IW.
    expect(byLabel.get('Painting Handover (LineNo)')).toEqual([2, 2, 1])
    expect(byLabel.get('Insulation Handover (LineNo)')).toEqual([0, 2, 0])
    expect(byLabel.get('Insulation Work (LineNo)')).toEqual([0, 2, 0])
    expect(byLabel.get('Ngưỡng trễ (ngày)')).toEqual([7, null, null])
    expect(byLabel.get('Spool trễ')).toEqual([2, null, null])
    const reinRow = rows.findIndex((r) => r[0] === 'Reinstatement (TestPack)') + 2
    expect(ws.getCell(`D${reinRow}`).numFmt).toBe('0.00%')
    const dayRow = rows.findIndex((r) => r[0] === 'Ngày xuất') + 2
    expect(ws.getCell(`B${dayRow}`).numFmt).toBe('dd/mm/yyyy')
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FFFAE2D5' } })
  })

  it('Tóm tắt: no total Test Pack leaves the total and % empty, Ngày view', async () => {
    const wb = await open(await buildPipingReport(input({
      settings: { weekStartDate: '2026-09-28', totalTestPacks: null, lateThresholdDays: 7 },
    })))
    const ws = sheet(wb, 'Tóm tắt')
    const rows = Array.from({ length: ws.rowCount - 1 }, (_, i) => rowValues(ws, i + 2))
    expect(rows.find((r) => r[0] === 'Reinstatement (TestPack)')).toEqual(['Reinstatement (TestPack)', 8, null, null])
    expect(rows.find((r) => r[0] === 'Chế độ xem')?.[1]).toBe('Ngày')
  })

  it('Reinstatement, day view: one row per day, Plan, Actual and the cumulative lines, actual empty after today', async () => {
    const wb = await open(await buildPipingReport(input()))
    const ws = sheet(wb, 'Reinstatement')
    expect(headerOf(ws)).toEqual(['Ngày', 'Plan theo ngày', 'Actual theo ngày', 'Plan lũy kế', 'Actual lũy kế'])
    expect(rowValues(ws, 2)).toEqual([utc('2026-09-30'), 10, 4, 10, 4])
    expect(rowValues(ws, 3)).toEqual([utc('2026-10-01'), 5, 4, 15, 8])
    expect(rowValues(ws, 4)).toEqual([utc('2026-10-02'), 0, 0, 15, 8])
    expect(rowValues(ws, 5)).toEqual([utc('2026-10-03'), 0, null, 15, null])
    expect(rowValues(ws, 7)).toEqual([utc('2026-10-05'), 7, null, 22, null])
    expect(ws.rowCount).toBe(7)
    expect(ws.getCell('A2').numFmt).toBe('dd/mm/yyyy')
    expect(ws.getCell('B2').numFmt).toBe('#,##0')
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  })

  it('Reinstatement, week view: one row per week with its first and last day', async () => {
    const wb = await open(await buildPipingReport(input({ mode: 'week' })))
    const ws = sheet(wb, 'Reinstatement')
    expect(headerOf(ws)).toEqual(['Tuần (từ ngày)', 'Đến ngày', 'Plan theo tuần', 'Actual theo tuần', 'Plan lũy kế', 'Actual lũy kế'])
    expect(rowValues(ws, 2)).toEqual([utc('2026-09-28'), utc('2026-10-04'), 15, 8, 15, 8])
    expect(rowValues(ws, 3)).toEqual([utc('2026-10-05'), utc('2026-10-11'), 7, null, 22, null])
    expect(ws.getCell('B2').numFmt).toBe('dd/mm/yyyy')
  })

  it('Manpower: Plan and Actual per group in sort order, then the totals; week headers say trung bình', async () => {
    const day = sheet(await open(await buildPipingReport(input())), 'Manpower')
    expect(headerOf(day)).toEqual([
      'Ngày', 'Reinstatement – Plan', 'Reinstatement – Actual', 'Insulation – Plan', 'Insulation – Actual',
      'Tổng Plan', 'Tổng Actual',
    ])
    expect(rowValues(day, 2)).toEqual([utc('2026-09-30'), 4, 3, 6, null, 10, 3])
    expect(rowValues(day, 3)).toEqual([utc('2026-10-01'), 2, 1.5, null, null, 2, 1.5])
    expect(day.getCell('C3').numFmt).toBe('#,##0.00')

    const week = sheet(await open(await buildPipingReport(input({ mode: 'week' }))), 'Manpower')
    expect(headerOf(week)).toEqual([
      'Tuần (từ ngày)', 'Đến ngày',
      'Reinstatement – Plan (trung bình)', 'Reinstatement – Actual (trung bình)',
      'Insulation – Plan (trung bình)', 'Insulation – Actual (trung bình)',
      'Tổng Plan (trung bình)', 'Tổng Actual (trung bình)',
    ])
    expect(rowValues(week, 2)).toEqual([utc('2026-09-28'), utc('2026-10-04'), 3, 2.25, 6, null, 9, 2.25])
  })

  it('Insulation: six cumulative series in the chosen unit, per bucket', async () => {
    const wb = await open(await buildPipingReport(input({ mode: 'week', unit: 'testPackageNo' })))
    const ws = sheet(wb, 'Insulation')
    expect(headerOf(ws)).toEqual([
      'Tuần (từ ngày)', 'Đến ngày',
      'Painting Handover – Plan lũy kế (Test Package No)', 'Painting Handover – Actual lũy kế (Test Package No)',
      'Insulation Handover – Plan lũy kế (Test Package No)', 'Insulation Handover – Actual lũy kế (Test Package No)',
      'Insulation Work – Plan lũy kế (Test Package No)', 'Insulation Work – Actual lũy kế (Test Package No)',
    ])
    const expected = pipingReportSeries(input({ mode: 'week', unit: 'testPackageNo' })).insulation.points
    expect(ws.rowCount).toBe(expected.length + 1)
    const last = expected[expected.length - 1]
    expect(rowValues(ws, ws.rowCount)).toEqual([
      utc(last.start), utc(last.end),
      last.phPlan, last.phActual, last.ihPlan, last.ihActual, last.iwPlan, last.iwActual,
    ])
    // Two packages, each one spool, both through PH by today.
    expect(last.phActual).toBe(2)
    expect(ws.getCell('C2').numFmt).toBe('#,##0')
  })

  it('Spool trễ: spool, line, package, milestone, department, plan, actual, days late, by package', async () => {
    const wb = await open(await buildPipingReport(input()))
    const ws = sheet(wb, 'Spool trễ')
    expect(headerOf(ws)).toEqual(['SpoolNo', 'LineNo', 'Test Package No', 'Mốc', 'Bộ phận', 'Plan', 'Actual', 'Số ngày trễ'])
    // TP1 first: SP-B's IH, planned 01/09, no actual, 31 days by today. Then TP2: SP-A's PH, 19 days late.
    expect(rowValues(ws, 2)).toEqual(['SP-B', 'L2', 'TP1', 'Insulation Handover', 'Painting', utc('2026-09-01'), null, 31])
    expect(rowValues(ws, 3)).toEqual(['SP-A', 'L1', 'TP2', 'Painting Handover', 'Piping', utc('2026-09-01'), utc('2026-09-20'), 19])
    expect(ws.rowCount).toBe(3)
    expect(ws.getCell('F2').numFmt).toBe('dd/mm/yyyy')
  })

  it('embeds each chart PNG on its sheet, right of the table', async () => {
    const png = { base64: PNG_1PX, width: 1000, height: 400 }
    const wb = await open(await buildPipingReport(input({ charts: { reinstatement: png, manpower: png, insulation: png } })))
    for (const name of ['Reinstatement', 'Manpower', 'Insulation']) {
      const images = sheet(wb, name).getImages()
      expect(images).toHaveLength(1)
      expect(images[0].range.tl.nativeCol).toBe(sheet(wb, name).columnCount + 1)
    }
    expect(sheet(wb, 'Tóm tắt').getImages()).toHaveLength(0)
  })

  it('writes "Không vẽ được biểu đồ" under the table instead of a chart that failed', async () => {
    const png = { base64: PNG_1PX, width: 1000, height: 400 }
    const wb = await open(await buildPipingReport(input({ charts: { reinstatement: 'failed', manpower: png } })))
    const ws = sheet(wb, 'Reinstatement')
    expect(ws.getImages()).toHaveLength(0)
    expect(ws.getCell(`A${ws.rowCount}`).value).toBe(CHART_FAILED)
    expect(ws.getCell(`A${ws.rowCount - 1}`).value).toBeNull()
    expect(sheet(wb, 'Manpower').getImages()).toHaveLength(1)
  })
})

describe('pipingReportFileName (R-16)', () => {
  it('is <code>_Piping_<YYYY-MM-DD>.xlsx', () => {
    expect(pipingReportFileName('DH', '2026-10-07')).toBe('DH_Piping_2026-10-07.xlsx')
  })
})
