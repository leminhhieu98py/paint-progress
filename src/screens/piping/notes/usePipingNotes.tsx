import { Alert, Button } from 'antd'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { DayKey } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { listNotes, type NoteAnchor, type PipingNoteEntry } from '../../../lib/pipingApi'
import { space } from '../../../theme'
import { usePanelData } from '../usePanelData'
import { anchorKey, groupNotes } from './noteAnchors'
import { NotesButton } from './NotesButton'
import { NotesDrawer } from './NotesDrawer'

/**
 * The admin's notes (spec §9) on a Piping tab: a Reinstatement day, a Manpower
 * day or a spool. Only the admin's panels read them -- a foreman's or a
 * viewer's never calls `listNotes` (the database would give them nothing
 * anyway) and gets no `action`, so nothing notes-related renders on a field
 * screen.
 */

/** Renders a target's note icon; `title` heads its drawer. */
export type NoteAction = (anchor: NoteAnchor, title: string) => ReactNode

const readNone = async (): Promise<PipingNoteEntry[]> => []

export function usePipingNotes(projectId: string, refreshKey: number, admin: boolean): {
  /** Undefined for a foreman or a viewer. */
  action: NoteAction | undefined
  /** The open target's drawer, if any. */
  drawer: ReactNode
  /** A warning for the panel while the notes cannot be read, with Thử lại. */
  alert: ReactNode
} {
  const { data, error, reload } = usePanelData(projectId, refreshKey, admin ? listNotes : readNone)
  const threads = useMemo(() => groupNotes(data ?? []), [data])
  const [open, setOpen] = useState<{ projectId: string; anchor: NoteAnchor; title: string } | null>(null)

  const action = useCallback<NoteAction>((anchor, title) => (
    <NotesButton
      count={threads.get(anchorKey(anchor))?.length ?? 0}
      failed={error !== null}
      onClick={() => setOpen({ projectId, anchor, title })}
    />
  ), [threads, projectId, error])

  // Another project's target never stays open.
  const shown = admin && open !== null && open.projectId === projectId ? open : null
  return {
    action: admin ? action : undefined,
    drawer: shown && (
      <NotesDrawer
        projectId={projectId}
        title={shown.title}
        anchor={shown.anchor}
        notes={threads.get(anchorKey(shown.anchor)) ?? []}
        error={error}
        onRetry={reload}
        onClose={() => setOpen(null)}
        onChanged={reload}
      />
    ),
    // Unread is not "no notes": the panel says so, the icons too.
    alert: admin && error !== null && (
      <Alert
        type="warning"
        showIcon
        message="Không tải được ghi chú"
        description={error}
        action={<Button onClick={reload}>Thử lại</Button>}
      />
    ),
  }
}

/** A day table's `dayExtra`: the note icon beside the date. */
export function dayNotes(action: NoteAction, target: 'reinstatement_day' | 'manpower_day', tab: string) {
  return (day: DayKey) => (
    <span style={{ marginInlineStart: space.sm }}>
      {action({ target, day }, `Ghi chú ${tab} ${formatDayMonthYear(day)}`)}
    </span>
  )
}
