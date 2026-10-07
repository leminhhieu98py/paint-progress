import type { DayKey, ImportKind, NoteTarget, PipingImportLogEntry, PipingNote } from '../../domain/piping/types'
import { supabase } from '../supabase'
import { isDayKey, nameOf, readAll, requireRows, requiredText, toError } from './shared'

/**
 * The two admin-only tables (spec §8, §9): notes and the import log. RLS gives
 * a GS or a viewer no row of either, so these are called from admin screens
 * only; a non-admin read returns an empty list, not an error.
 */

/** A note with the names behind its stamps. */
export interface PipingNoteEntry extends PipingNote {
  authorName: string | null
  updatedByName: string | null
}

const NOTE_SELECT =
  'id, target, day, spool_id, body, author, created_at, updated_by, updated_at,'
  + ' author_profile:profiles!piping_notes_author_fkey(full_name),'
  + ' updater_profile:profiles!piping_notes_updated_by_fkey(full_name)'

const EMPTY_BODY = 'Nội dung ghi chú không được để trống'
export const SPOOL_GONE = 'Spool này không còn trong dự án (kế hoạch vừa được nhập lại?)'

function mapNote(r: Record<string, unknown>): PipingNoteEntry {
  return {
    id: r.id as string,
    target: r.target as NoteTarget,
    day: (r.day as string | null) ?? null,
    spoolId: (r.spool_id as string | null) ?? null,
    body: r.body as string,
    authorId: (r.author as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
    authorName: nameOf(r.author_profile),
    updatedByName: nameOf(r.updater_profile),
  }
}

/** Every note of the project, oldest first. Paged. Admin only. */
export async function listNotes(projectId: string): Promise<PipingNoteEntry[]> {
  const rows = await readAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('piping_notes')
      .select(NOTE_SELECT)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  )
  return rows.map(mapNote)
}

/** Where a new note hangs: a Reinstatement or Manpower day, or a spool. */
export type NoteAnchor =
  | { target: 'reinstatement_day' | 'manpower_day'; day: DayKey }
  | { target: 'spool'; spoolId: string }

/** Admin: adds a note. The author and times are stamped by the trigger. */
export async function addNote(projectId: string, anchor: NoteAnchor, body: string): Promise<PipingNoteEntry> {
  const text = requiredText(body, EMPTY_BODY)
  let place: { target: NoteTarget; day: DayKey | null; spool_id: string | null }
  if (anchor.target === 'spool') {
    if (!anchor.spoolId) throw new Error('Thiếu spool')
    place = { target: 'spool', day: null, spool_id: anchor.spoolId }
  } else {
    if (!isDayKey(anchor.day)) throw new Error('Thiếu ngày')
    place = { target: anchor.target, day: anchor.day, spool_id: null }
  }
  const { data, error } = await supabase
    .from('piping_notes')
    .insert({ project_id: projectId, ...place, body: text })
    .select(NOTE_SELECT)
    .single()
  // A spool deleted by a Plan import while the note dialog was open (Q19A).
  if (error) throw toError(error, anchor.target === 'spool' ? { foreignKey: SPOOL_GONE } : {})
  return mapNote(data as unknown as Record<string, unknown>)
}

/** Admin: edits a note's text (stamped updated_by/at). */
export async function updateNote(id: string, body: string): Promise<void> {
  const text = requiredText(body, EMPTY_BODY)
  const { data, error } = await supabase.from('piping_notes').update({ body: text }).eq('id', id).select('id')
  if (error) throw toError(error)
  requireRows(data)
}

/** Admin: deletes a note. */
export async function deleteNote(id: string): Promise<void> {
  const { data, error } = await supabase.from('piping_notes').delete().eq('id', id).select('id')
  if (error) throw toError(error)
  requireRows(data)
}

/** A log row with the importer's name. */
export interface PipingImportLogRow extends PipingImportLogEntry {
  importedByName: string | null
}

/** Every confirmed import of the project, newest first (Cấu hình). Paged. Admin only. */
export async function listImportLog(projectId: string): Promise<PipingImportLogRow[]> {
  const rows = await readAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('piping_import_log')
      .select(
        'id, kind, file_name, row_count, summary, imported_by, imported_at,'
        + ' importer:profiles!piping_import_log_imported_by_fkey(full_name)',
      )
      .eq('project_id', projectId)
      .order('imported_at', { ascending: false })
      .order('id', { ascending: false })
      .range(a, b),
  )
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as ImportKind,
    fileName: (r.file_name as string | null) ?? '',
    rowCount: Number(r.row_count),
    summary: r.summary && typeof r.summary === 'object' ? (r.summary as Record<string, unknown>) : {},
    importedBy: (r.imported_by as string | null) ?? null,
    importedAt: (r.imported_at as string | null) ?? null,
    importedByName: nameOf(r.importer),
  }))
}
