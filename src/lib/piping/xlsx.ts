import { MAX_IMPORT_BYTES, type CellValue, type SheetRows } from '../../domain/piping/imports'

/**
 * Reads an uploaded workbook into plain cell values for the Piping imports
 * (spec §8). Everything about columns, dates and validation lives in
 * `domain/piping/imports.ts`; this file only opens the file.
 *
 * ExcelJS is imported dynamically, for the reason `reportXlsx.ts` gives: it is
 * the largest dependency in the tree, and nothing should download it until
 * somebody actually picks a file.
 */

/** A file that cannot be read at all; the message is for the user. */
export class PipingFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PipingFileError'
  }
}

/**
 * One ExcelJS cell value as a plain value: a formula as its cached result, rich
 * text and hyperlinks as their text, an error as its code ("#N/A") so a date
 * column reports it rather than reading it as blank. Anything else is null.
 */
export function normalizeCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if ('formula' in o || 'sharedFormula' in o || 'result' in o) return normalizeCell(o.result)
  if (Array.isArray(o.richText)) {
    return (o.richText as Array<{ text?: unknown }>).map((r) => (typeof r.text === 'string' ? r.text : '')).join('')
  }
  if ('text' in o) return normalizeCell(o.text)
  if (typeof o.error === 'string') return o.error
  return null
}

function isBlob(source: Blob | ArrayBuffer | Uint8Array): source is Blob {
  return typeof (source as Blob).arrayBuffer === 'function' && typeof (source as Blob).size === 'number'
}

/**
 * Every worksheet of an .xlsx, in workbook order, as rows of cell values:
 * `rows[i]` is sheet row `i + 1` (an empty row is `[]`), `rows[i][j]` column
 * `j + 1`. Refuses a file over 5 MB before opening it, and anything ExcelJS
 * cannot open (an .xls, a .csv, a damaged file) with a message for the user.
 */
export async function readWorkbookRows(source: Blob | ArrayBuffer | Uint8Array): Promise<SheetRows[]> {
  const size = isBlob(source) ? source.size : source.byteLength
  if (size > MAX_IMPORT_BYTES) throw new PipingFileError('File lớn hơn 5 MB')
  const data = isBlob(source) ? await source.arrayBuffer() : source
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  try {
    await wb.xlsx.load(data as ArrayBuffer)
  } catch {
    throw new PipingFileError('Không đọc được file. Hãy chọn file Excel (.xlsx)')
  }
  return wb.worksheets.map((ws) => {
    const rows: CellValue[][] = []
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: CellValue[] = []
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = normalizeCell(cell.value)
      })
      for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = null
      while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop()
      rows[rowNumber - 1] = cells
    })
    for (let i = 0; i < rows.length; i += 1) if (rows[i] === undefined) rows[i] = []
    return { name: ws.name, rows }
  })
}
