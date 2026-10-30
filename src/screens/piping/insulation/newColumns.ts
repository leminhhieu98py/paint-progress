import { normalizeHeader, type NewSpoolColumn } from '../../../domain/piping/imports'
import { addSpoolColumn, listSpoolColumns } from '../../../lib/pipingApi'
import { nextSort } from '../config/ordering'

/**
 * Creates the extra columns a Plan file brings (RV9-1, Q4), after the
 * configured ones in file order. The Plan commit runs it BEFORE the
 * replace/merge function, which keeps only the values of configured labels.
 * The two are not one transaction: if that function then fails, the columns
 * created stay, empty and harmless. The columns are read afresh, so one the
 * project already has (a retry after such a failure, another admin) is not
 * added twice.
 */
export async function addNewSpoolColumns(projectId: string, columns: NewSpoolColumn[]): Promise<void> {
  if (columns.length === 0) return
  const existing = await listSpoolColumns(projectId)
  const have = new Set(existing.map((c) => normalizeHeader(c.label)))
  let sort = nextSort(existing)
  for (const c of columns) {
    if (have.has(normalizeHeader(c.label))) continue
    await addSpoolColumn(projectId, c.label, sort, c.kind)
    sort += 1
  }
}
