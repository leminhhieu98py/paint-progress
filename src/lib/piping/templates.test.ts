import { describe, expect, it } from 'vitest'
import {
  parseManpowerActual,
  parseManpowerPlan,
  parseReinstatementActual,
  parseReinstatementPlan,
  parseSpoolActual,
  parseSpoolPlan,
} from '../../domain/piping/imports'
import {
  buildManpowerActualTemplate,
  buildManpowerPlanTemplate,
  buildReinstatementActualTemplate,
  buildReinstatementPlanTemplate,
  buildSpoolActualTemplate,
  buildSpoolPlanTemplate,
  templateFileName,
} from './templates'
import { readWorkbookRows } from './xlsx'

const headerOf = async (blob: Blob) => {
  const [sheet] = await readWorkbookRows(blob)
  return { name: sheet.name, header: sheet.rows[0], sheets: [sheet] }
}

describe('import templates (spec §8)', () => {
  it('Reinstatement Plan: Date, Plan Qty, and the importer accepts it', async () => {
    const t = await headerOf(await buildReinstatementPlanTemplate())
    expect(t.name).toBe('Reinstatement Plan')
    expect(t.header).toEqual(['Date', 'Plan Qty'])
    const res = parseReinstatementPlan(t.sheets)
    expect(res.errors).toEqual([])
    expect(res.rows).toEqual([])
  })

  it('Manpower Plan: Date + one column per given group, in the order given', async () => {
    const groups = [
      { id: 'g1', name: 'Reinstatement', sort: 1, hidden: false },
      { id: 'g2', name: 'Insulation', sort: 2, hidden: false },
      { id: 'g3', name: 'Marking', sort: 3, hidden: true },
    ]
    const t = await headerOf(await buildManpowerPlanTemplate(groups.map((g) => g.name)))
    expect(t.name).toBe('Manpower Plan')
    expect(t.header).toEqual(['Date', 'Reinstatement', 'Insulation', 'Marking'])
    expect(parseManpowerPlan(t.sheets, groups).errors).toEqual([])
  })

  it('Reinstatement Actual: Date, Actual Qty, and the importer accepts it (RV8-6)', async () => {
    const t = await headerOf(await buildReinstatementActualTemplate())
    expect(t.name).toBe('Reinstatement Actual')
    expect(t.header).toEqual(['Date', 'Actual Qty'])
    expect(parseReinstatementActual(t.sheets, '2026-10-07').errors).toEqual([])
  })

  it('Manpower Actual: Date + one column per given group, hidden ones included (RV8-6)', async () => {
    const groups = [
      { id: 'g1', name: 'Reinstatement', sort: 1, hidden: false },
      { id: 'g3', name: 'Marking', sort: 3, hidden: true },
    ]
    const t = await headerOf(await buildManpowerActualTemplate(groups.map((g) => g.name)))
    expect(t.name).toBe('Manpower Actual')
    expect(t.header).toEqual(['Date', 'Reinstatement', 'Marking'])
    expect(parseManpowerActual(t.sheets, groups, '2026-10-07').errors).toEqual([])
  })

  it('Insulation Plan: the master columns, Area and Length, the extra columns, then the Plan columns (RV9-1, Q6)', async () => {
    const t = await headerOf(await buildSpoolPlanTemplate(['Area', 'Zone']))
    expect(t.name).toBe('Insulation Plan')
    expect(t.header).toEqual(['SpoolNo', 'LineNo', 'InsuType', 'DrawingNo', 'Test Package No', 'Painting System',
      'Area (m2)', 'Length (mm)', 'Area', 'Zone', 'Pip Plan', 'Paint Plan', 'Insu Plan'])
    const res = parseSpoolPlan(t.sheets, [{ label: 'Area' }, { label: 'Zone' }])
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([])
    expect(res.newColumns.map((c) => c.label)).toEqual(['Area (m2)', 'Length (mm)'])
  })

  it('Insulation Plan: Area and Length once, where a configured column already names them (case and space blind)', async () => {
    const t = await headerOf(await buildSpoolPlanTemplate(['Zone', 'length(MM)', 'AREA (M2)']))
    expect(t.header).toEqual(['SpoolNo', 'LineNo', 'InsuType', 'DrawingNo', 'Test Package No', 'Painting System',
      'Zone', 'length(MM)', 'AREA (M2)', 'Pip Plan', 'Paint Plan', 'Insu Plan'])
  })

  it('Insulation Actual: SpoolNo and the three Actual columns', async () => {
    const t = await headerOf(await buildSpoolActualTemplate())
    expect(t.name).toBe('Insulation Actual')
    expect(t.header).toEqual(['SpoolNo', 'Pip Act', 'Paint Act', 'Insu Act'])
    expect(parseSpoolActual(t.sheets).errors).toEqual([])
  })

  it('formats the date columns dd/mm/yyyy and freezes the header', async () => {
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()
    await wb.xlsx.load(await (await buildSpoolPlanTemplate([])).arrayBuffer())
    const sheet = wb.worksheets[0]
    // Pip Plan, after the six master columns, Area (m2) and Length (mm).
    expect(sheet.getColumn(9).numFmt).toBe('dd/mm/yyyy')
    expect(sheet.getColumn(1).numFmt ?? null).not.toBe('dd/mm/yyyy')
    expect(sheet.getColumn(7).numFmt ?? null).not.toBe('dd/mm/yyyy')
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  })

  it('reads back a filled template: a real date cell and a typed number survive the round trip', async () => {
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()
    await wb.xlsx.load(await (await buildReinstatementPlanTemplate()).arrayBuffer())
    const sheet = wb.worksheets[0]
    sheet.getCell('A2').value = new Date(Date.UTC(2026, 8, 18))
    sheet.getCell('B2').value = 15
    sheet.getCell('A3').value = '25/09/2026'
    sheet.getCell('B3').value = '20,5'
    const filled = await wb.xlsx.writeBuffer()
    const res = parseReinstatementPlan(await readWorkbookRows(new Uint8Array(filled as ArrayBuffer)))
    expect(res.errors).toEqual([])
    expect(res.rows).toEqual([{ day: '2026-09-18', planQty: 15 }, { day: '2026-09-25', planQty: 20.5 }])
  })

  it('names each template file after its import', () => {
    expect(templateFileName('reinstatement_plan')).toBe('Mau_Reinstatement_Plan.xlsx')
    expect(templateFileName('manpower_plan')).toBe('Mau_Manpower_Plan.xlsx')
    expect(templateFileName('spool_plan')).toBe('Mau_Insulation_Plan.xlsx')
    expect(templateFileName('spool_actual')).toBe('Mau_Insulation_Actual.xlsx')
    expect(templateFileName('reinstatement_actual')).toBe('Mau_Reinstatement_Actual.xlsx')
    expect(templateFileName('manpower_actual')).toBe('Mau_Manpower_Actual.xlsx')
  })
})
