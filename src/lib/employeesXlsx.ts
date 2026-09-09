import type { Employee } from './employeesApi'

/**
 * The staff roster as an XLSX (Feedback Rv5, item 4).
 *
 * Linh asked to be able to take the list off the screen and check it against
 * the yard's own paperwork -- 32 names today, and it grows with the yard.
 *
 * ExcelJS is imported dynamically, for the reason `reportXlsx.ts` gives: it is
 * the largest dependency in the tree, and nothing should download it until
 * somebody actually presses an export button.
 *
 * The chrome below (tinted frozen header, ruled cells) repeats `reportXlsx.ts`
 * rather than importing from it. That module is 25 KB of project-report logic
 * with a static import of the whole `domain/report` graph; reaching into it for
 * a fill colour would tie the roster screen to all of that to save ten lines
 * that are pure presentation. A pager is shared because two copies would
 * disagree about a bay; a border does not have that problem.
 */

/** The header tint on the customer's own Dashboard sheet, matching reportXlsx. */
const HEADER_FILL = 'FFFAE2D5'
const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }

/**
 * The roster stores ONE string per person: "MC005593 - Cao Minh Hải", and
 * sometimes just "GG". So the code is read off the front rather than kept in a
 * column of its own, and a name without one exports a BLANK code -- never a
 * guess. Split on the FIRST ' - ' only: "MC1 - Trần Anh - Tuấn" is one person
 * whose name contains a dash, not a code and two names.
 */
export function splitEmployeeName(fullName: string): { code: string; name: string } {
  const at = fullName.indexOf(' - ')
  if (at === -1) return { code: '', name: fullName.trim() }
  return { code: fullName.slice(0, at).trim(), name: fullName.slice(at + 3).trim() }
}

/**
 * The whole roster, retired names included (RV5-08) -- not the filtered view.
 * A name taken out of the GS picker is still on every update it was ever
 * recorded against, so a list that dropped it would not match the history the
 * reader is checking it against. `Đang làm` says which is which.
 */
export async function buildEmployeesXlsx(rows: Employee[]): Promise<Blob> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const sheet = wb.addWorksheet('Nhân viên')
  sheet.columns = [
    { header: 'Mã', key: 'code', width: 16 },
    { header: 'Họ tên', key: 'name', width: 32 },
    { header: 'Đang làm', key: 'active', width: 12 },
  ]
  for (const row of rows) {
    const { code, name } = splitEmployeeName(row.fullName)
    sheet.addRow({ code, name, active: row.active ? 'Có' : 'Không' })
  }

  // Frozen, not decoration: the roster is already past a screenful, and a
  // column of Có/Không with the header scrolled off says nothing.
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
      if (n === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
        cell.font = { ...cell.font, bold: true }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      }
    })
  })

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** The filename the admin will be looking at in a folder of these next year. */
export function employeesFileName(today: string): string {
  return `nhan-vien-${today}.xlsx`
}
