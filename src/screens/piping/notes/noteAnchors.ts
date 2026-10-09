import type { NoteAnchor, PipingNoteEntry } from '../../../lib/pipingApi'

/** One key per note target: a Reinstatement day, a Manpower day, a spool (spec §9). */
export function anchorKey(anchor: NoteAnchor): string {
  return anchor.target === 'spool' ? `spool|${anchor.spoolId}` : `${anchor.target}|${anchor.day}`
}

function noteAnchor(note: PipingNoteEntry): NoteAnchor | null {
  if (note.target === 'spool') return note.spoolId === null ? null : { target: 'spool', spoolId: note.spoolId }
  return note.day === null ? null : { target: note.target, day: note.day }
}

/** How many notes each spool carries, by spool id. */
export function spoolNoteCounts(notes: PipingNoteEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const n of notes) {
    if (n.target === 'spool' && n.spoolId !== null) out.set(n.spoolId, (out.get(n.spoolId) ?? 0) + 1)
  }
  return out
}

/**
 * The project's notes threaded per target, newest first: a target may carry
 * several notes, and the latest is the one an admin reads first.
 */
export function groupNotes(notes: PipingNoteEntry[]): Map<string, PipingNoteEntry[]> {
  const out = new Map<string, PipingNoteEntry[]>()
  for (const n of notes) {
    const anchor = noteAnchor(n)
    if (anchor === null) continue
    const key = anchorKey(anchor)
    const list = out.get(key)
    if (list) list.push(n)
    else out.set(key, [n])
  }
  for (const list of out.values()) list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return out
}
