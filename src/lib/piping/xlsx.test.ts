import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_BYTES } from '../../domain/piping/imports'
import { PipingFileError, normalizeCell, readWorkbookRows } from './xlsx'

async function workbookBuffer(build: (wb: import('exceljs').Workbook) => void): Promise<ArrayBuffer> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  build(wb)
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer).slice().buffer
}

describe('normalizeCell', () => {
  it('passes plain values through and blanks undefined', () => {
    const d = new Date('2026-09-18T00:00:00Z')
    expect(normalizeCell('x')).toBe('x')
    expect(normalizeCell(3)).toBe(3)
    expect(normalizeCell(true)).toBe(true)
    expect(normalizeCell(d)).toBe(d)
    expect(normalizeCell(undefined)).toBeNull()
    expect(normalizeCell(null)).toBeNull()
  })

  it('takes a formula\'s result, the text of rich text and of a hyperlink, and an error\'s code', () => {
    const d = new Date('2026-08-14T00:00:00Z')
    expect(normalizeCell({ formula: 'B6-7', result: d })).toBe(d)
    expect(normalizeCell({ sharedFormula: 'C5', result: 32 })).toBe(32)
    expect(normalizeCell({ formula: 'A1' })).toBeNull()
    expect(normalizeCell({ richText: [{ text: 'Spool' }, { text: 'No' }] })).toBe('SpoolNo')
    expect(normalizeCell({ text: 'TP-1', hyperlink: 'https://example.test' })).toBe('TP-1')
    expect(normalizeCell({ error: '#N/A' })).toBe('#N/A')
    expect(normalizeCell({ formula: 'X', result: { error: '#REF!' } })).toBe('#REF!')
  })
})

describe('readWorkbookRows', () => {
  it('reads every sheet into rows of cell values, sheet row i at index i - 1', async () => {
    const buffer = await workbookBuffer((wb) => {
      const a = wb.addWorksheet('Plan')
      a.getCell('A1').value = 'Reinstatement'
      a.getCell('A3').value = 'Date'
      a.getCell('B3').value = 'Plan Qty'
      a.getCell('A4').value = new Date('2026-09-18T00:00:00Z')
      a.getCell('C4').value = { formula: '1+1', result: 2 }
      wb.addWorksheet('Empty')
    })
    const sheets = await readWorkbookRows(buffer)
    expect(sheets.map((s) => s.name)).toEqual(['Plan', 'Empty'])
    const rows = sheets[0].rows
    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual(['Reinstatement'])
    expect(rows[1]).toEqual([])
    expect(rows[2]).toEqual(['Date', 'Plan Qty'])
    expect(rows[3][0]).toEqual(new Date('2026-09-18T00:00:00Z'))
    expect(rows[3][1]).toBeNull()
    expect(rows[3][2]).toBe(2)
    expect(sheets[1].rows).toEqual([])
  })

  it('reads a Blob (a File from an upload) the same way', async () => {
    const buffer = await workbookBuffer((wb) => { wb.addWorksheet('S').getCell('B2').value = 'x' })
    const sheets = await readWorkbookRows(new Blob([buffer]))
    expect(sheets[0].rows).toEqual([[], [null, 'x']])
  })

  it('refuses a file over 5 MB before reading it', async () => {
    await expect(readWorkbookRows(new ArrayBuffer(MAX_IMPORT_BYTES + 1)))
      .rejects.toEqual(new PipingFileError('File lớn hơn 5 MB'))
  })

  it('refuses something that is not an .xlsx', async () => {
    const err = await readWorkbookRows(new TextEncoder().encode('Date,Plan Qty\n').buffer).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PipingFileError)
    expect((err as Error).message).toBe('Không đọc được file. Hãy chọn file Excel (.xlsx)')
  })
})
