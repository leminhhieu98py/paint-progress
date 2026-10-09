import { Alert, Button } from 'antd'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { IconAction } from '../../../components/IconAction'
import type { DayKey } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { listNotes, type NoteAnchor, type PipingNoteEntry } from '../../../lib/pipingApi'
import { space } from '../../../theme'
import { usePanelData } from '../usePanelData'
import { anchorKey, groupNotes } from './noteAnchors'
import { NotesButton } from './NotesButton'
import { NotesDrawer, type NoteDayPicker } from './NotesDrawer'

/**
 * The admin's notes (spec §9) on a Piping tab: a Reinstatement day, a Manpower
 * day or a spool. Only the admin's panels read them -- a foreman's or a
 * viewer's never calls `listNotes` (the database would give them nothing
 * anyway) and gets no `action`, so nothing notes-related renders on a field
 * screen.
 */

type DayTarget = 'reinstatement_day' | 'manpower_day'

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
  /** Reads the notes again (after a write elsewhere: a Plan import deletes removed spools' notes). */
  reload: () => void
  /**
   * "Ghi chú theo ngày" (admin): any day of the tab, picked in the drawer --
   * a day with no entry row too, and a day whose rows were deleted. Undefined
   * for a foreman or a viewer.
   */
  byDay: ((target: DayTarget, tab: string, todayKey: DayKey) => ReactNode) | undefined
} {
  const { data, error, reload } = usePanelData(projectId, refreshKey, admin ? listNotes : readNone)
  const threads = useMemo(() => groupNotes(data ?? []), [data])
  const [open, setOpen] = useState<{ projectId: string; anchor: NoteAnchor; title: string; byDay?: boolean } | null>(null)

  const action = useCallback<NoteAction>((anchor, title) => (
    <NotesButton
      count={threads.get(anchorKey(anchor))?.length ?? 0}
      failed={error !== null}
      onClick={() => setOpen({ projectId, anchor, title })}
    />
  ), [threads, projectId, error])

  const byDay = useCallback((target: DayTarget, tab: string, todayKey: DayKey) => (
    <IconAction
      verb="notes"
      label="Ghi chú theo ngày"
      onClick={() => setOpen({ projectId, anchor: { target, day: todayKey }, title: `Ghi chú theo ngày ${tab}`, byDay: true })}
    />
  ), [projectId])

  // Another project's target never stays open.
  const shown = admin && open !== null && open.projectId === projectId ? open : null
  const shownAnchor = shown?.anchor
  const days = useMemo((): NoteDayPicker | undefined => {
    if (!shown?.byDay || shownAnchor === undefined || shownAnchor.target === 'spool') return undefined
    const target = shownAnchor.target
    const noted = [...threads.entries()]
      .filter(([key]) => key.startsWith(`${target}|`))
      .map(([key, list]) => ({ day: key.slice(target.length + 1), count: list.length }))
      .sort((a, b) => (a.day < b.day ? 1 : -1))
    return { value: shownAnchor.day, noted, onChange: (day) => setOpen((o) => o && { ...o, anchor: { target, day } }) }
  }, [shown?.byDay, shownAnchor, threads])
  return {
    action: admin ? action : undefined,
    reload,
    byDay: admin ? byDay : undefined,
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
        days={days}
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
