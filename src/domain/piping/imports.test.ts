import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_ROWS,
  builtInSpoolHeader,
  diffManpowerActual,
  diffManpowerPlan,
  diffManpowerPlanUpdate,
  diffReinstatementActual,
  diffReinstatementPlan,
  diffReinstatementPlanUpdate,
  diffSpoolPlan,
  diffSpoolPlanUpdate,
  normalizeHeader,
  SPOOL_ACTUAL_COLUMNS,
  SPOOL_MASTER_COLUMNS,
  SPOOL_PLAN_COLUMNS,
  parseDayCell,
  parseManpowerActual,
  parseManpowerPlan,
  parseNumberCell,
  parseReinstatementActual,
  parseReinstatementPlan,
  parseSpoolActual,
  parseSpoolPlan,
  resolveSpoolActualImport,
  textCell,
  type CellValue,
  type SheetRows,
} from './imports'
import type { ManpowerGroup, Spool } from './types'

const sheet = (rows: CellValue[][], name = 'Sheet1'): SheetRows[] => [{ name, rows }]
const utc = (day: string) => new Date(`${day}T00:00:00Z`)

const PLAN_HEADERS = ['SpoolNo', 'LineNo', 'InsuType', 'DrawingNo', 'Test Package No', 'Painting System',
  'Painting Handover – Plan', 'Insulation Handover – Plan', 'Insulation Work – Plan']

const spool = (over: Partial<Spool>): Spool => ({
  id: 'x', seq: 1, spoolNo: 'X', lineNo: null, insuType: null, drawingNo: null, testPackageNo: null,
  paintingSystem: null, extra: {}, phPlan: null, ihPlan: null, iwPlan: null,
  phActual: null, ihActual: null, iwActual: null, ...over,
})

describe('normalizeHeader', () => {
  it('ignores case, spaces and every kind of dash', () => {
    expect(normalizeHeader('Painting Handover – Plan')).toBe(normalizeHeader('painting handover - plan'))
    expect(normalizeHeader(' Test  Package No ')).toBe('testpackageno')
    expect(normalizeHeader('Insulation Work—Plan')).toBe('insulationworkplan')
  })
})

describe('milestone headers (RV8-4)', () => {
  it('names the template columns Pip / Paint / Insu Plan and Act', () => {
    expect(Object.values(SPOOL_PLAN_COLUMNS).map((c) => c.label)).toEqual(['Pip Plan', 'Paint Plan', 'Insu Plan'])
    expect(Object.values(SPOOL_ACTUAL_COLUMNS).map((c) => c.label)).toEqual(['Pip Act', 'Paint Act', 'Insu Act'])
  })

  it('still reads every old header and the customer wording', () => {
    const cases: Array<[string, string]> = [
      ['Painting Handover – Plan', 'Pip Plan'],
      ['Insulation Handover – Plan', 'Paint Plan'],
      ['Insulation Work – Plan', 'Insu Plan'],
      ['Painting Handover – Actual', 'Pip Act'],
      ['Insulation Handover – Actual', 'Paint Act'],
      ['Insulation Work – Actual', 'Insu Act'],
      ['PH Plan', 'Pip Plan'],
      ['IH Plan', 'Paint Plan'],
      ['IW Plan', 'Insu Plan'],
      ['PH Actual', 'Pip Act'],
      ['IH Actual', 'Paint Act'],
      ['IW Actual', 'Insu Act'],
      ['Handover to Painting – Plan', 'Pip Plan'],
      ['Handover to Insulation – Plan', 'Paint Plan'],
      ['Insulation Work – Plan', 'Insu Plan'],
      ['Handover to Painting – Actual', 'Pip Act'],
      ['Handover to Insulation – Actual', 'Paint Act'],
      ['pip plan', 'Pip Plan'],
      ['Insu-Act', 'Insu Act'],
    ]
    for (const [header, label] of cases) expect([header, builtInSpoolHeader(header)]).toEqual([header, label])
  })

  it('reads no header as two built-in columns', () => {
    const specs = [
      ...Object.values(SPOOL_MASTER_COLUMNS), ...Object.values(SPOOL_PLAN_COLUMNS), ...Object.values(SPOOL_ACTUAL_COLUMNS),
    ]
    const owner = new Map<string, string>()
    for (const spec of specs) {
      for (const name of [spec.label, ...spec.aliases]) {
        const key = normalizeHeader(name)
        expect([name, owner.get(key) ?? spec.label]).toEqual([name, spec.label])
        owner.set(key, spec.label)
      }
    }
  })

  it('imports a plan file with the new headers and one with the customer wording', () => {
    for (const headers of [
      ['SpoolNo', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['SpoolNo', 'Handover to Painting – Plan', 'Handover to Insulation – Plan', 'Insulation Work – Plan'],
    ]) {
      const res = parseSpoolPlan(sheet([headers, ['A', '01/10/2026', '02/10/2026', '03/10/2026']]), [])
      expect(res.errors).toEqual([])
      expect(res.rows.map((r) => [r.phPlan, r.ihPlan, r.iwPlan])).toEqual([['2026-10-01', '2026-10-02', '2026-10-03']])
    }
  })
})

describe('builtInSpoolHeader', () => {
  it('names the built-in header a label would be read as, aliases included, or null', () => {
    expect(builtInSpoolHeader('line no')).toBe('LineNo')
    expect(builtInSpoolHeader('IH-Actual')).toBe('Paint Act')
    expect(builtInSpoolHeader('Test Pack')).toBe('Test Package No')
    expect(builtInSpoolHeader('Zone')).toBeNull()
  })
})

describe('parseDayCell', () => {
  it('reads an Excel date, dd/mm/yyyy, yyyy-mm-dd and an Excel serial number', () => {
    expect(parseDayCell(utc('2026-09-18'))).toEqual({ day: '2026-09-18' })
    expect(parseDayCell('18/09/2026')).toEqual({ day: '2026-09-18' })
    expect(parseDayCell('8/9/2026')).toEqual({ day: '2026-09-08' })
    expect(parseDayCell(' 2026-09-18 ')).toEqual({ day: '2026-09-18' })
    expect(parseDayCell(46283)).toEqual({ day: '2026-09-18' })
  })

  it('rounds a date cell and a bare serial for the same instant to the same day (nearest second, then the wall date)', () => {
    // 23:59:59.4 stays on the 17th, 23:59:59.6 rounds to midnight of the 18th -- on both paths.
    expect(parseDayCell(new Date('2026-09-17T23:59:59.400Z'))).toEqual({ day: '2026-09-17' })
    expect(parseDayCell(new Date('2026-09-17T23:59:59.600Z'))).toEqual({ day: '2026-09-18' })
    expect(parseDayCell(46282 + 86399.4 / 86400)).toEqual({ day: '2026-09-17' })
    expect(parseDayCell(46282 + 86399.6 / 86400)).toEqual({ day: '2026-09-18' })
    expect(parseDayCell(46282.5)).toEqual({ day: '2026-09-17' })
  })

  it('refuses a number outside the 2000-2100 serial window, and an invalid or far Date, as a row error rather than throwing', () => {
    for (const probe of [84901234567, -1e9, 1e300, -1e300, Infinity, -Infinity, NaN, 36525, 73416, 0]) {
      expect(parseDayCell(probe), String(probe)).toEqual({ error: `Ngày không hợp lệ: "${probe}"` })
    }
    expect(parseDayCell(36526)).toEqual({ day: '2000-01-01' })
    expect(parseDayCell(73415)).toEqual({ day: '2100-12-31' })
    expect(parseDayCell(new Date('not a date'))).toEqual({ error: 'Ngày không hợp lệ: ""' })
    expect(parseDayCell(new Date(8.64e15))).toEqual({ error: 'Ngày không hợp lệ: ""' })
    expect(parseDayCell(new Date(Date.UTC(1999, 11, 31)))).toEqual({ error: 'Ngày không hợp lệ: "31/12/1999"' })
    expect(parseDayCell(new Date(Date.UTC(2101, 0, 1)))).toEqual({ error: 'Ngày không hợp lệ: "01/01/2101"' })
  })

  it('reads blank as no value', () => {
    expect(parseDayCell(null)).toBeNull()
    expect(parseDayCell('   ')).toBeNull()
  })

  it('refuses text that is not a calendar day', () => {
    expect(parseDayCell('31/02/2026')).toEqual({ error: 'Ngày không hợp lệ: "31/02/2026"' })
    expect(parseDayCell('09/18/2026')).toEqual({ error: 'Ngày không hợp lệ: "09/18/2026"' })
    expect(parseDayCell('soon')).toEqual({ error: 'Ngày không hợp lệ: "soon"' })
    expect(parseDayCell(12.5)).toEqual({ error: 'Ngày không hợp lệ: "12.5"' })
    expect(parseDayCell(true)).toEqual({ error: 'Ngày không hợp lệ: "true"' })
  })
})

describe('textCell', () => {
  it('reads a date as its day key, and a Date too far to have one as blank, without throwing', () => {
    expect(textCell(utc('2026-09-18'))).toBe('2026-09-18')
    expect(textCell(new Date(8.64e15))).toBeNull()
    expect(textCell(new Date('x'))).toBeNull()
  })
})

describe('parseNumberCell', () => {
  it('reads numbers and vi or en decimal text, as parseViDecimal does', () => {
    expect(parseNumberCell(12)).toEqual({ value: 12 })
    expect(parseNumberCell('2,5')).toEqual({ value: 2.5 })
    expect(parseNumberCell('1.230,5')).toEqual({ value: 1230.5 })
    expect(parseNumberCell('1,230.5')).toEqual({ value: 1230.5 })
    expect(parseNumberCell('2.5')).toEqual({ value: 2.5 })
  })

  it('reads blank as no value and refuses anything else', () => {
    expect(parseNumberCell(null)).toBeNull()
    expect(parseNumberCell(' ')).toBeNull()
    expect(parseNumberCell('abc')).toEqual({ error: 'Không phải số: "abc"' })
    expect(parseNumberCell(utc('2026-09-18'))).toEqual({ error: 'Không phải số: "18/09/2026"' })
    expect(parseNumberCell(new Date(8.64e15))).toEqual({ error: 'Không phải số: ""' })
  })

  it('reads plain grouped and signed numbers in vi or en form', () => {
    expect(parseNumberCell('1234')).toEqual({ value: 1234 })
    expect(parseNumberCell('1234,5')).toEqual({ value: 1234.5 })
    expect(parseNumberCell('1234.5')).toEqual({ value: 1234.5 })
    expect(parseNumberCell('1.234.567')).toEqual({ value: 1234567 })
    expect(parseNumberCell('1.234.567,89')).toEqual({ value: 1234567.89 })
    expect(parseNumberCell('1,234,567.89')).toEqual({ value: 1234567.89 })
    expect(parseNumberCell(' 1\u00a0234,5 ')).toEqual({ value: 1234.5 })
    // Negative reads as a number so the caller can say "phải ≥ 0".
    expect(parseNumberCell('-5')).toEqual({ value: -5 })
  })

  it('refuses text with anything but digits and one decimal separator, rather than reading another number', () => {
    for (const probe of ['12/05', '1:30', '(5)', '5%', '+3', '2,5.', '1.2.3,4', '1,2,3', '.5', '5,', '1e3', '5 kg', '--5']) {
      expect(parseNumberCell(probe), probe).toEqual({ error: `Không phải số: "${probe}"` })
    }
  })
})

describe('parseReinstatementPlan (spec §8)', () => {
  it('reads Date + Plan Qty rows, skipping blank rows, header found below a title', () => {
    const res = parseReinstatementPlan(sheet([
      ['Reinstatement plan'],
      [],
      ['date', 'PLAN QTY'],
      [utc('2026-09-18'), 15],
      [],
      ['25/09/2026', '20,5'],
    ]))
    expect(res.errors).toEqual([])
    expect(res.rows).toEqual([{ day: '2026-09-18', planQty: 15 }, { day: '2026-09-25', planQty: 20.5 }])
    expect(res.rowCount).toBe(2)
    expect(res.sheetName).toBe('Sheet1')
  })

  it('reports every bad row with its sheet row number', () => {
    const res = parseReinstatementPlan(sheet([
      ['Date', 'Plan Qty'],
      ['2026-09-18', 5],
      ['2026-09-18', 6],
      ['x', 1],
      [null, 3],
      ['2026-09-20', -1],
      ['2026-09-21', null],
      ['2026-09-22', 'lots'],
    ]))
    expect(res.errors).toEqual([
      { row: 3, message: 'Ngày 18/09/2026 trùng với dòng 2' },
      { row: 4, message: 'Ngày không hợp lệ: "x"' },
      { row: 5, message: 'Thiếu Date' },
      { row: 6, message: 'Plan Qty phải ≥ 0' },
      { row: 7, message: 'Thiếu Plan Qty' },
      { row: 8, message: 'Plan Qty: Không phải số: "lots"' },
    ])
  })

  it('names the missing columns when no header row is found', () => {
    const res = parseReinstatementPlan(sheet([['Ngày làm', 'Số lượng'], ['2026-09-18', 5]]))
    expect(res.errors).toEqual([{ row: null, message: 'Không tìm thấy dòng tiêu đề có các cột: Date, Plan Qty' }])
    expect(res.rows).toEqual([])
  })

  it('picks the sheet that has the header', () => {
    const res = parseReinstatementPlan([
      { name: 'Ghi chú', rows: [['Hướng dẫn']] },
      { name: 'Plan', rows: [['Date', 'Plan Qty'], ['2026-09-18', 1]] },
    ])
    expect(res.sheetName).toBe('Plan')
    expect(res.rows).toHaveLength(1)
  })

  it('refuses a file with more than the row limit', () => {
    const rows: CellValue[][] = [['Date', 'Plan Qty']]
    for (let i = 0; i <= MAX_IMPORT_ROWS; i += 1) rows.push(['2026-09-18', 1])
    const res = parseReinstatementPlan(sheet(rows))
    expect(res.errors).toEqual([{ row: null, message: `File có ${MAX_IMPORT_ROWS + 1} dòng, tối đa ${MAX_IMPORT_ROWS}` }])
    expect(res.rows).toEqual([])
  })

  it('refuses a workbook without sheets', () => {
    expect(parseReinstatementPlan([]).errors).toEqual([{ row: null, message: 'File không có sheet nào' }])
  })
})

describe('plan amounts: one comma then three digits', () => {
  const COMMA_NOTE = '"1,234" được đọc là 1,234 (dấu phẩy là dấu thập phân), không phải 1234'

  it('reads "1,234" as the vi decimal 1.234 and warns, without blocking', () => {
    const res = parseReinstatementPlan(sheet([['Date', 'Plan Qty'], ['25/09/2026', '1,234']]))
    expect(res.errors).toEqual([])
    expect(res.rows).toEqual([{ day: '2026-09-25', planQty: 1.234 }])
    expect(res.warnings).toEqual([{ row: 2, message: COMMA_NOTE }])
  })

  it('warns the same on a Manpower cell', () => {
    const res = parseManpowerPlan(sheet([['Date', 'Insulation'], ['25/09/2026', ' 1,234 ']]), [
      { id: 'g2', name: 'Insulation', sort: 1, hidden: false },
    ])
    expect(res.errors).toEqual([])
    expect(res.rows).toEqual([{ groupId: 'g2', day: '2026-09-25', value: 1.234 }])
    expect(res.warnings).toEqual([{ row: 2, message: COMMA_NOTE }])
  })

  it('says what a longer amount is not read as', () => {
    const res = parseReinstatementPlan(sheet([['Date', 'Plan Qty'], ['25/09/2026', '12,500']]))
    expect(res.warnings).toEqual([
      { row: 2, message: '"12,500" được đọc là 12,5 (dấu phẩy là dấu thập phân), không phải 12500' },
    ])
  })

  it.each(['20,5', '1,2345', '1.234,567', '12,34', '1234', '1,234.5'])('does not warn on %s', (text) => {
    expect(parseReinstatementPlan(sheet([['Date', 'Plan Qty'], ['25/09/2026', text]])).warnings).toEqual([])
  })
})

describe('parseManpowerPlan (spec §8, R-14)', () => {
  const groups: ManpowerGroup[] = [
    { id: 'g1', name: 'Reinstatement', sort: 1, hidden: false },
    { id: 'g2', name: 'Insulation', sort: 2, hidden: false },
    { id: 'g3', name: 'Marking', sort: 3, hidden: true },
  ]

  it('reads Date + one column per group, hidden groups included, blank cells skipped', () => {
    const res = parseManpowerPlan(sheet([
      ['Date', 'reinstatement', 'Insulation', 'MARKING'],
      [utc('2026-09-18'), 33, 0, null],
      ['25/09/2026', '36', null, 10],
    ]), groups)
    expect(res.errors).toEqual([])
    expect(res.rows).toEqual([
      { groupId: 'g1', day: '2026-09-18', value: 33 },
      { groupId: 'g2', day: '2026-09-18', value: 0 },
      { groupId: 'g1', day: '2026-09-25', value: 36 },
      { groupId: 'g3', day: '2026-09-25', value: 10 },
    ])
    expect(res.rowCount).toBe(2)
  })

  it('refuses a header that is not a group, listing it so the admin creates the group first', () => {
    const res = parseManpowerPlan(sheet([['Date', 'Reinstatement', 'Welding', 'Total'], ['2026-09-18', 1, 2, 3]]), groups)
    expect(res.errors).toEqual([{ row: 1, message: 'Nhóm chưa có trong Cấu hình: Welding, Total (tạo nhóm trước khi nhập)' }])
    expect(res.rows).toEqual([])
  })

  it('refuses two columns for one group, a repeated date and a negative value', () => {
    expect(parseManpowerPlan(sheet([['Date', 'Insulation', 'insulation']]), groups).errors)
      .toEqual([{ row: 1, message: 'Cột nhóm Insulation lặp lại' }])
    const res = parseManpowerPlan(sheet([['Date', 'Insulation'], ['2026-09-18', 1], ['2026-09-18', 2], ['2026-09-19', -2]]), groups)
    expect(res.errors).toEqual([
      { row: 3, message: 'Ngày 18/09/2026 trùng với dòng 2' },
      { row: 4, message: 'Insulation phải ≥ 0' },
    ])
  })

  it('prefers the sheet whose header names a group over an earlier one that only has a Date column', () => {
    const res = parseManpowerPlan([
      { name: 'Reinstatement', rows: [['Ngày', 'Kế hoạch tuần'], ['2026-09-18', 5]] },
      { name: 'Manpower', rows: [['Date', 'Insulation'], ['2026-09-18', 7]] },
    ], groups)
    expect(res.sheetName).toBe('Manpower')
    expect(res.rows).toEqual([{ groupId: 'g2', day: '2026-09-18', value: 7 }])
  })

  it('tells apart two groups the database allows, "Mpr A" and "MprA" (lower(btrim) unique)', () => {
    const two: ManpowerGroup[] = [
      { id: 'a', name: 'Mpr A', sort: 1, hidden: false },
      { id: 'b', name: 'MprA', sort: 2, hidden: false },
    ]
    const res = parseManpowerPlan(sheet([['Date', ' mpr a ', 'MPRA'], ['2026-09-18', 1, 2]]), two)
    expect(res.errors).toEqual([])
    expect(res.rows).toEqual([
      { groupId: 'a', day: '2026-09-18', value: 1 },
      { groupId: 'b', day: '2026-09-18', value: 2 },
    ])
  })

  it('falls back to the dash- and space-blind match only when it names one group', () => {
    const res = parseManpowerPlan(sheet([['Date', 'Mpr-for-Reins'], ['2026-09-18', 4]]),
      [{ id: 'r', name: 'Mpr for Reins', sort: 1, hidden: false }])
    expect(res.rows).toEqual([{ groupId: 'r', day: '2026-09-18', value: 4 }])
    const ambiguous = parseManpowerPlan(sheet([['Date', 'Mpr-A'], ['2026-09-18', 4]]), [
      { id: 'a', name: 'Mpr A', sort: 1, hidden: false },
      { id: 'b', name: 'MprA', sort: 2, hidden: false },
    ])
    expect(ambiguous.errors).toEqual([{ row: 1, message: 'Nhóm chưa có trong Cấu hình: Mpr-A (tạo nhóm trước khi nhập)' }])
  })

  it('warns about a dated row with no value at all', () => {
    const res = parseManpowerPlan(sheet([['Date', 'Insulation'], ['2026-09-18', null]]), groups)
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([{ row: 2, message: 'Không có giá trị nào, bỏ qua' }])
  })
})

describe('parseSpoolPlan (spec §6.2)', () => {
  it('reads the master fields, extra columns and plan dates in file order, ignoring Actual columns (R-9)', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolsNo', 'Line No', 'InsuType', 'Drawing No', 'TestPackageNo', 'PaintingSystem',
        'Painting Handover – Plan', 'Painting Handover – Actual', 'Insulation Handover - Plan',
        'Insulation Work – Plan', 'Area'],
      ['SP-1', 'L1', 'HC', 'D1', 'TP1', 'BD-02B', utc('2026-10-20'), utc('2026-09-29'), '21/10/2026', null, 'Deck A'],
      ['SP-2', 'L1', 'HC', 12345, 'TP1', 'BD-02B', null, null, null, null, null],
    ]), [{ label: 'area' }])
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([])
    expect(res.rows).toEqual([
      { row: 2, seq: 1, spoolNo: 'SP-1', lineNo: 'L1', insuType: 'HC', drawingNo: 'D1', testPackageNo: 'TP1',
        paintingSystem: 'BD-02B', extra: { area: 'Deck A' }, phPlan: '2026-10-20', ihPlan: '2026-10-21', iwPlan: null },
      { row: 3, seq: 2, spoolNo: 'SP-2', lineNo: 'L1', insuType: 'HC', drawingNo: '12345', testPackageNo: 'TP1',
        paintingSystem: 'BD-02B', extra: {}, phPlan: null, ihPlan: null, iwPlan: null },
    ])
  })

  it('imports duplicate SpoolNo and plan-order breaks, listing them as warnings (Q14C, Q15B)', () => {
    const res = parseSpoolPlan(sheet([
      PLAN_HEADERS,
      ['A', null, null, null, null, null, '2026-10-05', '2026-10-01', null],
      ['B', null, null, null, null, null, null, null, null],
      ['A ', null, null, null, null, null, null, null, null],
    ]), [])
    expect(res.errors).toEqual([])
    expect(res.rows).toHaveLength(3)
    expect(res.duplicates.map((d) => [d.spoolNo, d.rows.map((r) => r.row)])).toEqual([['A', [2, 4]]])
    expect(res.planOrder.map((p) => [p.row.row, p.pairs])).toEqual([[2, [['ph', 'ih']]]])
    expect(res.warnings).toEqual([
      { row: 2, message: 'Sai thứ tự: Pip (05/10/2026) sau Paint (01/10/2026)' },
      { row: null, message: 'SpoolNo "A" lặp lại ở các dòng 2, 4' },
    ])
  })

  it('reports a row without SpoolNo, a bad date, and ignored or missing columns', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'Painting Handover – Plan', 'Insulation Handover – Plan', 'Insulation Work – Plan', 'Remarks'],
      [null, '2026-10-05', null, null, 'x'],
      ['C', 'next week', null, null, null],
    ]), [])
    expect(res.errors).toEqual([
      { row: 2, message: 'Thiếu SpoolNo' },
      { row: 3, message: 'Pip Plan: Ngày không hợp lệ: "next week"' },
    ])
    expect(res.warnings).toEqual([
      { row: 1, message: 'Không có cột: LineNo, InsuType, DrawingNo, Test Package No, Painting System' },
      { row: 1, message: 'Bỏ qua cột: Remarks' },
    ])
  })

  it('fills an extra column whose label is also a built-in alias when the built-in column has its own header', () => {
    const res = parseSpoolPlan(sheet([
      [...PLAN_HEADERS, 'Line'],
      ['A', 'L1', null, null, null, null, null, null, null, 'Deck 3'],
    ]), [{ label: 'Line' }])
    expect(res.warnings).toEqual([])
    expect(res.rows[0]).toMatchObject({ lineNo: 'L1', extra: { Line: 'Deck 3' } })
  })

  it('warns when an extra column label collides with a built-in name and so cannot be read', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'Line', 'Painting Handover – Plan', 'Insulation Handover – Plan', 'Insulation Work – Plan'],
      ['A', 'L1', null, null, null],
    ]), [{ label: 'line' }, { label: 'PH-Plan' }])
    expect(res.rows[0]).toMatchObject({ lineNo: 'L1', extra: {} })
    expect(res.warnings).toContainEqual({
      row: 1,
      message: 'Cột thêm "line" trùng tên cột chuẩn LineNo nên không đọc được; đổi tên cột thêm trong Cấu hình',
    })
    expect(res.warnings).toContainEqual({
      row: 1,
      message: 'Cột thêm "PH-Plan" trùng tên cột chuẩn Pip Plan nên không đọc được; đổi tên cột thêm trong Cấu hình',
    })
  })

  it('tells apart two extra labels the database allows', () => {
    const res = parseSpoolPlan(sheet([
      [...PLAN_HEADERS, 'Zone A', 'ZoneA'],
      ['A', null, null, null, null, null, null, null, null, 'x', 'y'],
    ]), [{ label: 'Zone A' }, { label: 'ZoneA' }])
    expect(res.rows[0].extra).toEqual({ 'Zone A': 'x', ZoneA: 'y' })
  })

  it('requires SpoolNo and the three Plan columns', () => {
    expect(parseSpoolPlan(sheet([['SpoolNo', 'Painting Handover – Plan']]), []).errors).toEqual([{
      row: null,
      message: 'Không tìm thấy dòng tiêu đề có các cột: SpoolNo, Pip Plan, Paint Plan, Insu Plan',
    }])
  })
})

describe('parseSpoolPlan: new columns before Pip Plan (RV9-1, Q3-Q5)', () => {
  it('makes an unknown header left of Pip Plan a new column and ignores one right of it', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'Area (m2)', '', 'Zone', 'Pip Plan', 'Paint Plan', 'Insu Plan', 'Remarks'],
      ['A', 12.5, 'x', 'Deck 1', null, null, null, 'r'],
      ['B', null, null, null, null, null, null, null],
    ]), [])
    expect(res.errors).toEqual([])
    expect(res.newColumns).toEqual([{ label: 'Area (m2)', kind: 'number' }, { label: 'Zone', kind: 'text' }])
    expect(res.warnings).toContainEqual({ row: 1, message: 'Bỏ qua cột: Remarks' })
    expect(res.rows.map((r) => r.extra)).toEqual([{ 'Area (m2)': '12.5', Zone: 'Deck 1' }, {}])
  })

  it('keeps today\'s matching: configured labels (case, space and dash blind) and built-in names are not new', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'LineNo', 'Line', 'zone', 'Mpr-A', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['A', 'L1', 'L2', 'z', 'm', null, null, null],
    ]), [{ label: 'Zone' }, { label: 'Mpr A' }, { label: 'MprA' }])
    expect(res.newColumns).toEqual([])
    expect(res.rows[0].extra).toEqual({ Zone: 'z' })
    expect(res.warnings).toContainEqual({ row: 1, message: 'Bỏ qua cột: Line, Mpr-A' })
  })

  it('creates a header repeated in the file once, ignoring the repeat', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'Area', 'area', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['A', 1, 'x', null, null, null],
    ]), [])
    expect(res.newColumns).toEqual([{ label: 'Area', kind: 'number' }])
    expect(res.rows[0].extra).toEqual({ Area: '1' })
    expect(res.warnings).toContainEqual({ row: 1, message: 'Bỏ qua cột: area' })
  })

  it('makes the template\'s Area and Length number columns always, even when blank; any other blank column is text', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'area(M2)', 'Length (mm)', 'Width', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['A', null, ' ', null, null, null, null],
    ]), [])
    expect(res.newColumns).toEqual([
      { label: 'area(M2)', kind: 'number' },
      { label: 'Length (mm)', kind: 'number' },
      { label: 'Width', kind: 'text' },
    ])
    // Always numbers: a number typed as text is read as one, anything else is a row error.
    const typed = parseSpoolPlan(sheet([
      ['SpoolNo', 'Area (m2)', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['A', '12,5', null, null, null],
      ['B', 'n/a', null, null, null],
    ]), [])
    expect(typed.newColumns).toEqual([{ label: 'Area (m2)', kind: 'number' }])
    expect(typed.errors).toEqual([{ row: 3, message: 'Area (m2): Không phải số: "n/a"' }])
    const ok = parseSpoolPlan(sheet([
      ['SpoolNo', 'Area (m2)', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['A', '12,5', null, null, null],
    ]), [])
    expect(ok.rows[0].extra).toEqual({ 'Area (m2)': '12.5' })
  })

  it('detects the kind: number only when every non-blank cell is a number cell; text such as "001" stays text', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'Num', 'Code', 'Vi', 'Mixed', 'Blank', 'Day', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['A', 1234.5, '001', '1.234,5', 12, null, utc('2026-10-01'), null, null, null],
      ['B', 7, '1.200', null, 'abc', ' ', null, null, null, null],
      ['C', null, null, null, null, null, null, null, null, null],
    ]), [])
    expect(res.errors).toEqual([])
    expect(res.newColumns).toEqual([
      { label: 'Num', kind: 'number' },
      { label: 'Code', kind: 'text' },
      { label: 'Vi', kind: 'text' },
      { label: 'Mixed', kind: 'text' },
      { label: 'Blank', kind: 'text' },
      { label: 'Day', kind: 'text' },
    ])
    expect(res.rows.map((r) => r.extra)).toEqual([
      { Num: '1234.5', Code: '001', Vi: '1.234,5', Mixed: '12', Day: '2026-10-01' },
      { Num: '7', Code: '1.200', Mixed: 'abc' },
      {},
    ])
  })

  it('never lets a new column make a row a data row: a numbered STT column or a totals row is not a spool', () => {
    const numbered = parseSpoolPlan(sheet([
      ['STT', 'SpoolNo', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      [1, 'A', null, null, null],
      [2, null, null, null, null],
      [3, null, null, null, null],
    ]), [])
    expect(numbered.errors).toEqual([])
    expect(numbered.rows.map((r) => [r.spoolNo, r.extra])).toEqual([['A', { STT: '1' }]])
    expect(numbered.newColumns).toEqual([{ label: 'STT', kind: 'number' }])

    const totals = parseSpoolPlan(sheet([
      ['SpoolNo', 'Area (m2)', 'Note', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['A', 2.5, null, null, null, null],
      ['B', 3, null, null, null, null],
      [null, 5.5, 'Tổng', null, null, null],
    ]), [])
    expect(totals.errors).toEqual([])
    expect(totals.rows.map((r) => r.spoolNo)).toEqual(['A', 'B'])
    // The totals row's text is not read, so Note stays blank: text by default.
    expect(totals.newColumns).toEqual([{ label: 'Area (m2)', kind: 'number' }, { label: 'Note', kind: 'text' }])
  })

  it('reads the same file the same way once its new columns exist: a configured column never makes a data row', () => {
    const files = [
      sheet([
        ['STT', 'SpoolNo', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
        [1, 'A', null, null, null],
        [2, null, null, null, null],
        [3, null, null, null, null],
      ]),
      sheet([
        ['SpoolNo', 'Area (m2)', 'Note', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
        ['A', 2.5, null, null, null, null],
        ['B', 3, null, null, null, null],
        [null, 5.5, 'Tổng', null, null, null],
      ]),
    ]
    for (const file of files) {
      const first = parseSpoolPlan(file, [])
      const second = parseSpoolPlan(file, first.newColumns)
      expect(second.newColumns).toEqual([])
      expect(second.errors).toEqual([])
      expect(second.rowCount).toBe(first.rowCount)
      expect(second.rows).toEqual(first.rows)
    }
  })

  it('refuses a negative value in a number column, new or configured', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'N', 'Pip Plan', 'Paint Plan', 'Insu Plan', 'Length (mm)'],
      ['A', -5, null, null, null, null],
      ['B', 1, null, null, null, '-1,5'],
    ]), [{ label: 'Length (mm)', kind: 'number' }])
    expect(res.errors).toEqual([
      { row: 2, message: 'N phải ≥ 0' },
      { row: 3, message: 'Length (mm) phải ≥ 0' },
    ])
    expect(res.rows).toEqual([])
  })

  it('stores a number as a plain decimal string, never in exponent form', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'N', 'Pip Plan', 'Paint Plan', 'Insu Plan'],
      ['A', 1e21, null, null, null],
      ['B', 1.5e-7, null, null, null],
    ]), [])
    expect(res.rows.map((r) => r.extra)).toEqual([{ N: '1000000000000000000000' }, { N: '0.00000015' }])
  })

  it('reads a configured number column as numbers anywhere in the file: a bad cell is a row error', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'Pip Plan', 'Paint Plan', 'Insu Plan', 'Length (mm)', 'Zone'],
      ['A', null, null, null, '1.200', '1.200'],
      ['B', null, null, null, 'abc', null],
    ]), [{ label: 'Length (mm)', kind: 'number' }, { label: 'Zone', kind: 'text' }])
    expect(res.newColumns).toEqual([])
    expect(res.errors).toEqual([{ row: 3, message: 'Length (mm): Không phải số: "abc"' }])
    expect(res.rows).toEqual([])

    const ok = parseSpoolPlan(sheet([
      ['SpoolNo', 'Pip Plan', 'Paint Plan', 'Insu Plan', 'Length (mm)', 'Zone'],
      ['A', null, null, null, '1.200', '1.200'],
      ['B', null, null, null, null, null],
    ]), [{ label: 'Length (mm)', kind: 'number' }, { label: 'Zone', kind: 'text' }])
    // A text column keeps the file's text; a blank number cell is left out, so Update Plan keeps the value.
    expect(ok.rows.map((r) => r.extra)).toEqual([{ 'Length (mm)': '1.2', Zone: '1.200' }, {}])
  })
})

describe('parseSpoolActual (spec §6.3)', () => {
  it('reads SpoolNo + any Actual column, merging a repeated SpoolNo that agrees', () => {
    const res = parseSpoolActual(sheet([
      ['SpoolNo', 'Insulation Handover – Actual', 'Painting Handover – Plan'],
      ['A', utc('2026-10-01'), utc('2026-12-01')],
      ['B', null, null],
      ['A', '01/10/2026', null],
    ]))
    expect(res.errors).toEqual([])
    expect(res.rows).toEqual([{ row: 2, spoolNo: 'A', dates: { ih: '2026-10-01' } }])
  })

  it('refuses a repeated SpoolNo whose dates disagree, and a date without SpoolNo', () => {
    const res = parseSpoolActual(sheet([
      ['SpoolNo', 'Painting Handover – Actual'],
      ['A', '2026-10-01'],
      ['A', '2026-10-02'],
      [null, '2026-10-02'],
    ]))
    expect(res.errors).toEqual([
      { row: 3, message: 'SpoolNo "A": Pip Act khác với dòng 2' },
      { row: 4, message: 'Thiếu SpoolNo' },
    ])
  })

  it('requires SpoolNo and at least one Actual column', () => {
    expect(parseSpoolActual(sheet([['SpoolNo', 'LineNo']])).errors).toEqual([{
      row: null,
      message: 'Không tìm thấy dòng tiêu đề có các cột: SpoolNo và ít nhất một cột Actual',
    }])
  })
})

describe('resolveSpoolActualImport (R-11, Q18A)', () => {
  const spools = [
    spool({ id: 'a1', seq: 1, spoolNo: 'A', phActual: '2026-09-01' }),
    spool({ id: 'a2', seq: 2, spoolNo: 'A' }),
    spool({ id: 'b', seq: 3, spoolNo: 'B', ihActual: '2026-09-05' }),
  ]
  const today = '2026-10-07'

  it('applies a SpoolNo to every matching spool, says so, and lists overwrites old -> new', () => {
    const res = resolveSpoolActualImport([{ row: 2, spoolNo: 'A', dates: { ph: '2026-09-03' } }], spools, today)
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([{ row: 2, message: 'SpoolNo "A" khớp 2 spool, áp dụng cho tất cả' }])
    expect(res.changes).toEqual([
      { spoolId: 'a1', milestone: 'ph', date: '2026-09-03' },
      { spoolId: 'a2', milestone: 'ph', date: '2026-09-03' },
    ])
    expect(res.overwrites).toEqual([{ row: 2, spoolId: 'a1', spoolNo: 'A', milestone: 'ph', from: '2026-09-01', to: '2026-09-03' }])
    expect(res.updates.map((u) => u.spoolId)).toEqual(['a1', 'a2'])
    expect(res.spoolCount).toBe(2)
    expect(res.unchangedCount).toBe(0)
  })

  it('reports unknown SpoolNo, future dates and order breaks as row errors', () => {
    const res = resolveSpoolActualImport([
      { row: 2, spoolNo: 'Z', dates: { ph: '2026-09-03' } },
      { row: 3, spoolNo: 'A', dates: { ih: '2026-10-08' } },
      { row: 4, spoolNo: 'B', dates: { ph: '2026-09-06' } },
      { row: 5, spoolNo: 'B', dates: { ih: '2026-09-05' } },
    ], spools, today)
    expect(res.errors).toEqual([
      { row: 2, message: 'Không tìm thấy SpoolNo "Z"' },
      { row: 3, message: 'Paint Act: ngày 08/10/2026 sau hôm nay' },
      { row: 4, message: 'SpoolNo "B": Sai thứ tự: Pip (06/09/2026) sau Paint (05/09/2026)' },
    ])
  })

  it('counts dates equal to what is stored as unchanged', () => {
    const res = resolveSpoolActualImport([{ row: 2, spoolNo: 'B', dates: { ih: '2026-09-05' } }], spools, today)
    expect(res.errors).toEqual([])
    expect(res.updates).toEqual([])
    expect(res.spoolCount).toBe(0)
    expect(res.unchangedCount).toBe(1)
  })
})

describe('diffs (spec §8)', () => {
  it('compares Reinstatement plans day by day', () => {
    const diff = diffReinstatementPlan(
      [{ day: '2026-09-18', planQty: 10 }, { day: '2026-09-25', planQty: 20 }, { day: '2026-10-02', planQty: 5 }],
      [{ day: '2026-09-25', planQty: 22 }, { day: '2026-09-18', planQty: 10 }, { day: '2026-10-09', planQty: 7 }],
    )
    expect(diff).toEqual({
      added: [{ day: '2026-10-09', to: 7 }],
      changed: [{ day: '2026-09-25', from: 20, to: 22 }],
      removed: [{ day: '2026-10-02', from: 5 }],
      unchangedCount: 1,
    })
  })

  it('compares Manpower plans by group and day, a group absent from the file removed', () => {
    const diff = diffManpowerPlan(
      [{ groupId: 'g1', day: '2026-09-18', value: 30 }, { groupId: 'g2', day: '2026-09-18', value: 5 }],
      [{ groupId: 'g1', day: '2026-09-18', value: 33 }, { groupId: 'g1', day: '2026-09-25', value: 36 }],
    )
    expect(diff).toEqual({
      added: [{ groupId: 'g1', day: '2026-09-25', to: 36 }],
      changed: [{ groupId: 'g1', day: '2026-09-18', from: 30, to: 33 }],
      removed: [{ groupId: 'g2', day: '2026-09-18', from: 5 }],
      unchangedCount: 0,
    })
  })

  it('matches spools by SpoolNo, pairing duplicates in file order (R-10), flagging removed spools with actuals (Q19A)', () => {
    const old = [
      spool({ id: 'o1', seq: 1, spoolNo: 'A', lineNo: 'L1', phPlan: '2026-10-01' }),
      spool({ id: 'o2', seq: 2, spoolNo: 'A', lineNo: 'L2' }),
      spool({ id: 'o3', seq: 3, spoolNo: 'B', ihActual: '2026-09-01' }),
      spool({ id: 'o4', seq: 4, spoolNo: 'C' }),
      spool({ id: 'o5', seq: 5, spoolNo: 'D', extra: { Area: 'X' } }),
    ]
    const next = parseSpoolPlan(sheet([
      [...PLAN_HEADERS, 'Area'],
      ['A', 'L1', null, null, null, null, '2026-10-03', null, null, null],
      ['D', null, null, null, null, null, null, null, null, 'Y'],
      ['A', 'L2', null, null, null, null, null, null, null, null],
      ['A', 'L3', null, null, null, null, null, null, null, null],
    ]), [{ label: 'Area' }]).rows
    const diff = diffSpoolPlan(old, next)
    expect(diff.matches).toEqual([{ oldId: 'o1', nextSeq: 1 }, { oldId: 'o2', nextSeq: 3 }, { oldId: 'o5', nextSeq: 2 }])
    expect(diff.added.map((r) => r.seq)).toEqual([4])
    expect(diff.removed.map((r) => [r.spool.id, r.hasActuals])).toEqual([['o3', true], ['o4', false]])
    expect(diff.changed.map((c) => [c.spool.id, c.changes])).toEqual([
      ['o1', [{ field: 'phPlan', label: 'Pip Plan', from: '2026-10-01', to: '2026-10-03' }]],
      ['o5', [{ field: 'extra', label: 'Area', from: 'X', to: 'Y' }]],
    ])
    expect(diff.unchangedCount).toBe(1)
  })
})

describe('Update Plan (RV8-5)', () => {
  it('skips a dated row without Plan Qty in update mode, and still refuses it in replace mode', () => {
    const rows: CellValue[][] = [['Date', 'Plan Qty'], ['2026-09-18', 5], ['2026-09-19', null], ['2026-09-20', 0]]
    expect(parseReinstatementPlan(sheet(rows)).errors).toEqual([{ row: 3, message: 'Thiếu Plan Qty' }])
    expect(parseReinstatementPlan(sheet(rows), 'replace').errors).toEqual([{ row: 3, message: 'Thiếu Plan Qty' }])
    const update = parseReinstatementPlan(sheet(rows), 'update')
    expect(update.errors).toEqual([])
    expect(update.rows).toEqual([{ day: '2026-09-18', planQty: 5 }, { day: '2026-09-20', planQty: 0 }])
    expect(update.warnings).toEqual([{ row: 3, message: 'Không có Plan Qty, bỏ qua' }])
    expect(update.rowCount).toBe(3)
  })

  it('still refuses a repeated date in update mode, a blank row included', () => {
    const res = parseReinstatementPlan(sheet([['Date', 'Plan Qty'], ['2026-09-18', 5], ['2026-09-18', null]]), 'update')
    expect(res.errors).toEqual([{ row: 3, message: 'Ngày 18/09/2026 trùng với dòng 2' }])
    expect(res.rows).toEqual([])
  })

  it('compares a Reinstatement update day by day, days absent from the file kept', () => {
    const diff = diffReinstatementPlanUpdate(
      [{ day: '2026-09-18', planQty: 10 }, { day: '2026-09-25', planQty: 20 }, { day: '2026-10-02', planQty: 5 }],
      [{ day: '2026-09-25', planQty: 22 }, { day: '2026-09-18', planQty: 10 }, { day: '2026-10-09', planQty: 0 }],
    )
    expect(diff).toEqual({
      added: [{ day: '2026-10-09', to: 0 }],
      changed: [{ day: '2026-09-25', from: 20, to: 22 }],
      removed: [],
      unchangedCount: 1,
    })
  })

  it('compares a Manpower update cell by cell, blank cells and absent days kept', () => {
    const diff = diffManpowerPlanUpdate(
      [{ groupId: 'g1', day: '2026-09-18', value: 30 }, { groupId: 'g2', day: '2026-09-18', value: 5 }],
      [{ groupId: 'g1', day: '2026-09-18', value: 33 }, { groupId: 'g2', day: '2026-09-25', value: 0 }],
    )
    expect(diff).toEqual({
      added: [{ groupId: 'g2', day: '2026-09-25', to: 0 }],
      changed: [{ groupId: 'g1', day: '2026-09-18', from: 30, to: 33 }],
      removed: [],
      unchangedCount: 0,
    })
  })

  it('merges spools: filled cells overwrite, empty cells keep, extras key-wise, new spools appended, none removed', () => {
    const old = [
      spool({ id: 'o1', seq: 1, spoolNo: 'A', lineNo: 'L1', testPackageNo: 'TP1', phPlan: '2026-10-01', extra: { Area: 'X', Zone: 'Z1' } }),
      spool({ id: 'o2', seq: 2, spoolNo: 'B', lineNo: 'L2', ihActual: '2026-09-01' }),
      spool({ id: 'o3', seq: 3, spoolNo: 'C', lineNo: 'L3', phPlan: '2026-10-01' }),
    ]
    const next = parseSpoolPlan(sheet([
      [...PLAN_HEADERS, 'Area', 'Zone'],
      ['A', 'L9', null, null, null, null, null, '2026-10-05', null, null, 'Z2'],
      ['C', null, null, null, null, null, '2026-10-01', null, null, null, null],
      ['D', 'L4', null, null, null, null, null, null, null, 'Y', null],
    ]), [{ label: 'Area' }, { label: 'Zone' }]).rows
    const diff = diffSpoolPlanUpdate(old, next)
    expect(diff.changed.map((c) => [c.spool.id, c.changes])).toEqual([
      ['o1', [
        { field: 'lineNo', label: 'LineNo', from: 'L1', to: 'L9' },
        { field: 'ihPlan', label: 'Paint Plan', from: null, to: '2026-10-05' },
        { field: 'extra', label: 'Zone', from: 'Z1', to: 'Z2' },
      ]],
    ])
    expect(diff.unchangedCount).toBe(1)
    expect(diff.added.map((r) => r.spoolNo)).toEqual(['D'])
    expect(diff.kept.map((s) => s.id)).toEqual(['o2'])
    expect(diff.merged.map((s) => [s.spoolNo, s.lineNo, s.testPackageNo, s.phPlan, s.ihPlan, s.extra])).toEqual([
      ['A', 'L9', 'TP1', '2026-10-01', '2026-10-05', { Area: 'X', Zone: 'Z2' }],
      ['B', 'L2', null, null, null, {}],
      ['C', 'L3', null, '2026-10-01', null, {}],
      ['D', 'L4', null, null, null, { Area: 'Y' }],
    ])
  })

  it('warns about duplicates and plan-order breaks of the merged spools, not of the file alone', () => {
    const old = [
      spool({ id: 'o1', seq: 1, spoolNo: 'A', ihPlan: '2026-10-01' }),
      spool({ id: 'o2', seq: 2, spoolNo: 'B', phPlan: '2026-10-09', ihPlan: '2026-10-01' }),
    ]
    const next = parseSpoolPlan(sheet([
      PLAN_HEADERS,
      ['A', null, null, null, null, null, '2026-10-05', null, null],
      ['A', null, null, null, null, null, null, null, null],
    ]), []).rows
    expect(diffSpoolPlanUpdate(old, next).warnings).toEqual([
      { row: 2, message: 'Sai thứ tự: Pip (05/10/2026) sau Paint (01/10/2026)' },
      { row: null, message: 'SpoolNo "B": Sai thứ tự: Pip (09/10/2026) sau Paint (01/10/2026)' },
      { row: null, message: 'SpoolNo "A" có 2 spool sau khi cập nhật' },
    ])
  })

  it('keeps the warnings about the file columns apart, for the update preview', () => {
    const res = parseSpoolPlan(sheet([
      ['SpoolNo', 'Painting Handover – Plan', 'Insulation Handover – Plan', 'Insulation Work – Plan', 'Note'],
      ['A', '2026-10-05', '2026-10-01', null, null],
    ]), [])
    expect(res.columnWarnings).toEqual([
      { row: 1, message: 'Không có cột: LineNo, InsuType, DrawingNo, Test Package No, Painting System' },
      { row: 1, message: 'Bỏ qua cột: Note' },
    ])
    expect(res.warnings.slice(0, 2)).toEqual(res.columnWarnings)
    expect(res.warnings).toHaveLength(3)
  })
})

describe('Actual imports for Reinstatement and Manpower (RV8-6)', () => {
  const TODAY = '2026-10-07'
  const groups: ManpowerGroup[] = [
    { id: 'g1', name: 'Reinstatement', sort: 1, hidden: false },
    { id: 'g3', name: 'Marking', sort: 3, hidden: true },
  ]

  it('reads Date + Actual Qty up to today, a blank cell skipped, 0 kept', () => {
    const res = parseReinstatementActual(sheet([
      ['Reinstatement actual'],
      ['date', 'ACTUAL QTY'],
      [utc('2026-10-01'), 15],
      ['02/10/2026', null],
      ['07/10/2026', '0'],
      ['08/10/2026', null],
    ]), TODAY)
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([])
    expect(res.rows).toEqual([{ day: '2026-10-01', qty: 15 }, { day: '2026-10-07', qty: 0 }])
    expect(res.rowCount).toBe(4)
  })

  it('refuses a future day, a repeated date, a negative or bad quantity and a missing header', () => {
    const res = parseReinstatementActual(sheet([
      ['Date', 'Actual Qty'],
      ['2026-10-01', 5],
      ['2026-10-01', 6],
      ['2026-10-08', 1],
      ['2026-10-02', -1],
      ['2026-10-03', 'x'],
      [null, 3],
    ]), TODAY)
    expect(res.errors).toEqual([
      { row: 3, message: 'Ngày 01/10/2026 trùng với dòng 2' },
      { row: 4, message: 'Không nhập được ngày trong tương lai (08/10/2026)' },
      { row: 5, message: 'Actual Qty phải ≥ 0' },
      { row: 6, message: 'Actual Qty: Không phải số: "x"' },
      { row: 7, message: 'Thiếu Date' },
    ])
    expect(res.rows).toEqual([])
    expect(parseReinstatementActual(sheet([['Date', 'Plan Qty'], ['2026-10-01', 5]]), TODAY).errors)
      .toEqual([{ row: null, message: 'Không tìm thấy dòng tiêu đề có các cột: Date, Actual Qty' }])
  })

  it('reads Date + one column per group into one row per day, hidden groups included, blanks skipped', () => {
    const res = parseManpowerActual(sheet([
      ['Date', 'reinstatement', 'Marking'],
      [utc('2026-10-01'), 33, 0],
      ['02/10/2026', null, 4],
      ['03/10/2026', null, null],
      ['08/10/2026', null, null],
    ]), groups, TODAY)
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([])
    expect(res.rows).toEqual([
      { day: '2026-10-01', values: { g1: 33, g3: 0 } },
      { day: '2026-10-02', values: { g3: 4 } },
    ])
  })

  it('refuses an unknown group, a repeated date and a future day with a value', () => {
    expect(parseManpowerActual(sheet([['Date', 'Reinstatement', 'Welding'], ['2026-10-01', 1, 2]]), groups, TODAY).errors)
      .toEqual([{ row: 1, message: 'Nhóm chưa có trong Cấu hình: Welding (tạo nhóm trước khi nhập)' }])
    const res = parseManpowerActual(sheet([
      ['Date', 'Reinstatement'], ['2026-10-01', 1], ['2026-10-01', 2], ['2026-10-09', 3],
    ]), groups, TODAY)
    expect(res.errors).toEqual([
      { row: 3, message: 'Ngày 01/10/2026 trùng với dòng 2' },
      { row: 4, message: 'Không nhập được ngày trong tương lai (09/10/2026)' },
    ])
    expect(res.rows).toEqual([])
  })

  it('compares a Reinstatement day total: added on an empty day, changed when the total differs', () => {
    const diff = diffReinstatementActual(
      [{ day: '2026-10-01', qty: 0.1 }, { day: '2026-10-01', qty: 0.2 }, { day: '2026-10-02', qty: 5 }, { day: '2026-10-03', qty: 2 }],
      [
        { day: '2026-10-01', qty: 0.3 },
        { day: '2026-10-02', qty: 7 },
        { day: '2026-10-03', qty: 0 },
        { day: '2026-10-04', qty: 4 },
        { day: '2026-10-05', qty: 0 },
      ],
    )
    expect(diff).toEqual({
      added: [{ day: '2026-10-04', to: 4 }],
      changed: [{ day: '2026-10-02', from: 5, to: 7 }, { day: '2026-10-03', from: 2, to: 0 }],
      removed: [],
      unchangedCount: 2,
    })
  })

  it('compares Manpower cells: added without a value, changed when it differs, other cells kept', () => {
    const diff = diffManpowerActual(
      [{ groupId: 'g1', day: '2026-10-01', value: 30 }, { groupId: 'g3', day: '2026-10-01', value: 2 }],
      [{ day: '2026-10-01', values: { g1: 33, g3: 2 } }, { day: '2026-10-02', values: { g1: 0 } }],
    )
    expect(diff).toEqual({
      added: [{ groupId: 'g1', day: '2026-10-02', to: 0 }],
      changed: [{ groupId: 'g1', day: '2026-10-01', from: 30, to: 33 }],
      removed: [],
      unchangedCount: 1,
    })
  })
})
