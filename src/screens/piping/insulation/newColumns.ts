import { normalizeHeader, type NewSpoolColumn } from '../../../domain/piping/imports'
import { addSpoolColumn, listSpoolColumns } from '../../../lib/pipingApi'
import { nextSort } from '../config/ordering'

/**
 * Creates the extra columns a Plan file brings (RV9-1, Q4), after the
 * configured ones in file order. The Plan commit runs it BEFORE the
 * replace/merge function, which refuses the whole write when a value is keyed
 * by a label that is not configured. The two are not one transaction: if that function then fails, the columns
 * created stay, empty and harmless. The columns are read afresh, so one the
 * project already has (a retry after such a failure, another admin) is not
 * added twice.
 *
 * Two races with another admin's column fail the import, and nothing is half
 * imported; a retry recovers both:
 * - the same label added between the read and the add: the database's unique
 *   label refuses the add, so no spool is written; the retry reads it and
 *   skips it;
 * - a label added since the page read its columns that matches a new one by
 *   `normalizeHeader` (case, space and dash blind; "Zone-A" for "Zone A") but
 *   not by the database's `lower(btrim())`: it is skipped here, and the
 *   replace/merge function then refuses the whole write, the value's label
 *   not being configured; once the page reads its columns again, the file's
 *   header matches that column and the retry writes under it.
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
