import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_ROWS,
  diffManpowerPlan,
  diffReinstatementPlan,
  diffSpoolPlan,
  normalizeHeader,
  parseDayCell,
  parseManpowerPlan,
  parseNumberCell,
  parseReinstatementPlan,
  parseSpoolActual,
  parseSpoolPlan,
  resolveSpoolActualImport,
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

describe('parseDayCell', () => {
  it('reads an Excel date, dd/mm/yyyy, yyyy-mm-dd and an Excel serial number', () => {
    expect(parseDayCell(utc('2026-09-18'))).toEqual({ day: '2026-09-18' })
    expect(parseDayCell('18/09/2026')).toEqual({ day: '2026-09-18' })
    expect(parseDayCell('8/9/2026')).toEqual({ day: '2026-09-08' })
    expect(parseDayCell(' 2026-09-18 ')).toEqual({ day: '2026-09-18' })
    expect(parseDayCell(46283)).toEqual({ day: '2026-09-18' })
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
      { row: 2, message: 'Sai thứ tự: Painting Handover (05/10/2026) sau Insulation Handover (01/10/2026)' },
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
      { row: 3, message: 'Painting Handover – Plan: Ngày không hợp lệ: "next week"' },
    ])
    expect(res.warnings).toEqual([
      { row: 1, message: 'Không có cột: LineNo, InsuType, DrawingNo, Test Package No, Painting System' },
      { row: 1, message: 'Bỏ qua cột: Remarks' },
    ])
  })

  it('requires SpoolNo and the three Plan columns', () => {
    expect(parseSpoolPlan(sheet([['SpoolNo', 'Painting Handover – Plan']]), []).errors).toEqual([{
      row: null,
      message: 'Không tìm thấy dòng tiêu đề có các cột: SpoolNo, Painting Handover – Plan, Insulation Handover – Plan, Insulation Work – Plan',
    }])
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
      { row: 3, message: 'SpoolNo "A": Painting Handover – Actual khác với dòng 2' },
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
      { row: 3, message: 'Insulation Handover – Actual: ngày 08/10/2026 sau hôm nay' },
      { row: 4, message: 'SpoolNo "B": Sai thứ tự: Painting Handover (06/09/2026) sau Insulation Handover (05/09/2026)' },
    ])
  })

  it('counts dates equal to what is stored as unchanged', () => {
    const res = resolveSpoolActualImport([{ row: 2, spoolNo: 'B', dates: { ih: '2026-09-05' } }], spools, today)
    expect(res.errors).toEqual([])
    expect(res.updates).toEqual([])
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
      ['o1', [{ field: 'phPlan', label: 'Painting Handover – Plan', from: '2026-10-01', to: '2026-10-03' }]],
      ['o5', [{ field: 'extra', label: 'Area', from: 'X', to: 'Y' }]],
    ])
    expect(diff.unchangedCount).toBe(1)
  })
})
