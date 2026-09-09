import { describe, expect, it } from 'vitest'
import { buildEmployeesXlsx, employeesFileName } from './employeesXlsx'
import type { Employee } from './employeesApi'

const emp = (id: string, fullName: string, active = true): Employee => ({ id, fullName, active })

/** Reads the produced file back through ExcelJS, so the assertions are about a
 *  real workbook rather than about the calls made to build one. */
async function readBack(blob: Blob) {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  return wb
}

const cells = (row: { values: unknown }) => (row.values as unknown[]).slice(1)

describe('buildEmployeesXlsx', () => {
  it('writes one sheet Nhân viên with the three columns and one row per name', async () => {
    const wb = await readBack(await buildEmployeesXlsx([
      emp('1', 'MC005593 - Cao Minh Hải'),
      emp('2', 'MC005594 - Nguyễn Văn A'),
    ]))

    expect(wb.worksheets.map((s) => s.name)).toEqual(['Nhân viên'])
    const sheet = wb.getWorksheet('Nhân viên')!
    expect(cells(sheet.getRow(1))).toEqual(['Mã', 'Họ tên', 'Đang làm'])
    expect(cells(sheet.getRow(2))).toEqual(['MC005593', 'Cao Minh Hải', 'Có'])
    expect(cells(sheet.getRow(3))).toEqual(['MC005594', 'Nguyễn Văn A', 'Có'])
    expect(sheet.rowCount).toBe(3)
  })

  it('leaves the code blank on a name that carries none, rather than inventing one', async () => {
    // The roster stores ONE string. "GG" is a real row on the customer's list.
    const wb = await readBack(await buildEmployeesXlsx([emp('1', 'GG')]))
    expect(cells(wb.getWorksheet('Nhân viên')!.getRow(2))).toEqual(['', 'GG', 'Có'])
  })

  it('splits on the first " - " only, so a dash inside the name survives', async () => {
    const wb = await readBack(await buildEmployeesXlsx([emp('1', 'MC1 - Trần Anh - Tuấn')]))
    expect(cells(wb.getWorksheet('Nhân viên')!.getRow(2))).toEqual(['MC1', 'Trần Anh - Tuấn', 'Có'])
  })

  it('writes the retired names too, marked Không', async () => {
    // RV5-08: the export is the whole roster. A name taken out of the GS
    // picker is still on every update it was ever recorded on.
    const wb = await readBack(await buildEmployeesXlsx([
      emp('1', 'MC1 - Cao Minh Hải'),
      emp('2', 'MC2 - Đã nghỉ', false),
    ]))
    const sheet = wb.getWorksheet('Nhân viên')!
    expect(cells(sheet.getRow(2))[2]).toBe('Có')
    expect(cells(sheet.getRow(3))[2]).toBe('Không')
  })

  it('freezes the header row, so a roster of 200 stays readable', async () => {
    const wb = await readBack(await buildEmployeesXlsx([emp('1', 'GG')]))
    expect(wb.getWorksheet('Nhân viên')!.views).toEqual([
      expect.objectContaining({ state: 'frozen', ySplit: 1 }),
    ])
  })

  it('writes a workbook for an empty roster rather than throwing', async () => {
    const wb = await readBack(await buildEmployeesXlsx([]))
    const sheet = wb.getWorksheet('Nhân viên')!
    expect(cells(sheet.getRow(1))).toEqual(['Mã', 'Họ tên', 'Đang làm'])
    expect(sheet.rowCount).toBe(1)
  })
})

describe('employeesFileName', () => {
  it('names the file by the day it was taken', () => {
    expect(employeesFileName('2026-09-09')).toBe('nhan-vien-2026-09-09.xlsx')
  })
})
