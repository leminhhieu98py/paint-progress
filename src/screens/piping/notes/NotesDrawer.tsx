import { Alert, Button, DatePicker, Drawer, Input, Space } from 'antd'
import dayjs from 'dayjs'
import { useRef, useState } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { EmptyState } from '../../../components/EmptyState'
import { IconAction } from '../../../components/IconAction'
import { useTypeScale } from '../../../components/typeScale'
import type { DayKey } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { formatDateTimeVN } from '../../../lib/format'
import { addNote, deleteNote, updateNote, type NoteAnchor, type PipingNoteEntry } from '../../../lib/pipingApi'
import { palette, space } from '../../../theme'
import { formatQty } from '../pipingFormat'

/**
 * The admin's notes on one target -- a Reinstatement day, a Manpower day or a
 * spool (spec §9) -- as a thread, newest first: a box to add one on top, then
 * each note with who wrote it and when (and who last edited it), editable in
 * place and deletable after a confirm. Admin only: the panels never render it
 * for a foreman or a viewer, and the database gives them no row anyway.
 */
/** "Ghi chú theo ngày": the day is picked in the drawer, among any date or the tab's noted days. */
export interface NoteDayPicker {
  /** The day whose notes are shown. */
  value: DayKey
  /** Every day of the tab that has notes, newest first, with or without an entry row. */
  noted: Array<{ day: DayKey; count: number }>
  onChange: (day: DayKey) => void
}

export function NotesDrawer({ projectId, title, anchor, notes, error, onRetry, onClose, onChanged, days }: {
  projectId: string
  title: string
  anchor: NoteAnchor
  /** The target's notes, newest first. */
  notes: PipingNoteEntry[]
  /** Why the notes could not be read, if they could not. */
  error: string | null
  onRetry: () => void
  onClose: () => void
  /** After a write: the notes are read again. */
  onChanged: () => void
  /** Day mode: a date picker and the noted days above the thread. */
  days?: NoteDayPicker
}) {
  const type = useTypeScale()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [removing, setRemoving] = useState<PipingNoteEntry | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  /** A step that would drop unsent text, waiting for the admin's word. */
  const [leaving, setLeaving] = useState<{ title: string; okText: string; then: () => void } | null>(null)

  /** An open edit that changed its note. */
  const editDirty = editing !== null && editing.body !== notes.find((n) => n.id === editing.id)?.body
  /** Text typed and not saved: a new note, or a changed edit. */
  const dirty = draft.trim() !== '' || editDirty
  /** Runs `then` at once, or after a confirm when it would drop unsent text. */
  const confirmIf = (drops: boolean, title: string, okText: string, then: () => void) => {
    if (drops) setLeaving({ title, okText, then })
    else then()
  }
  /** Another day: a typed new note stays (it is for the day picked); an open edit belongs to the old day. */
  const pickDay = (day: DayKey) => {
    if (days === undefined || day === days.value) return
    confirmIf(editDirty, 'Bỏ sửa ghi chú?', 'Vẫn đổi ngày', () => {
      setEditing(null)
      days.onChange(day)
    })
  }

  /** Set at once on a write, before the re-render: a second click in the same frame does nothing. */
  const inFlight = useRef(false)

  /** One write at a time; the notes are read again after it. */
  const write = async (run: () => Promise<unknown>, done: () => void, fail = setWriteError) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    fail(null)
    try {
      await run()
      done()
      onChanged()
    } catch (e) {
      fail((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Drawer title={title} open onClose={() => confirmIf(dirty, 'Đóng ghi chú?', 'Vẫn đóng', onClose)} width={440} destroyOnHidden>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        {error !== null && (
          <Alert
            type="error"
            showIcon
            message="Không tải được ghi chú"
            description={error}
            action={<Button onClick={onRetry}>Thử lại</Button>}
          />
        )}
        {days !== undefined && (
          <>
            <DatePicker
              aria-label="Ngày ghi chú"
              format="DD/MM/YYYY"
              allowClear={false}
              value={dayjs(days.value)}
              onChange={(d) => d && pickDay(d.format('YYYY-MM-DD'))}
              style={{ width: '100%' }}
            />
            {days.noted.length > 0 && (
              <div role="list" aria-label="Ngày có ghi chú" style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs }}>
                <span style={{ ...type.caption, color: palette.textTertiary, width: '100%' }}>Ngày có ghi chú</span>
                {days.noted.map((d) => (
                  <span role="listitem" key={d.day}>
                    <Button
                      type={d.day === days.value ? 'primary' : 'default'}
                      aria-pressed={d.day === days.value}
                      onClick={() => pickDay(d.day)}
                    >
                      {`${formatDayMonthYear(d.day)} (${formatQty(d.count)})`}
                    </Button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        {writeError !== null && <Alert type="error" showIcon message={writeError} />}
        <Input.TextArea
          aria-label="Ghi chú mới"
          placeholder="Nhập ghi chú"
          autoSize={{ minRows: 3, maxRows: 8 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            // Off while a note is being edited or anything is being saved: one write at a time.
            disabled={draft.trim() === '' || editing !== null || busy}
            loading={busy && editing === null && removing === null}
            onClick={() => void write(() => addNote(projectId, anchor, draft.trim()), () => setDraft(''))}
          >
            Thêm ghi chú
          </Button>
        </div>
        {notes.length === 0
          ? error === null && <EmptyState title="Chưa có ghi chú" />
          : (
            <div>
              {notes.map((n, i) => (
                <NoteItem
                  key={n.id}
                  note={n}
                  first={i === 0}
                  busy={busy}
                  editing={editing?.id === n.id ? editing.body : null}
                  onEdit={() => {
                    setWriteError(null)
                    setEditing({ id: n.id, body: n.body })
                  }}
                  onEditChange={(body) => setEditing({ id: n.id, body })}
                  onCancel={() => setEditing(null)}
                  onSave={() => {
                    if (editing === null) return
                    void write(() => updateNote(n.id, editing.body.trim()), () => setEditing(null))
                  }}
                  onDelete={() => {
                    setRemoveError(null)
                    setRemoving(n)
                  }}
                />
              ))}
            </div>
          )}
      </div>

      <ConsequenceModal
        open={removing !== null}
        tone="danger"
        title="Xoá ghi chú?"
        items={removing ? [{ label: removing.body, meta: removing.authorName ?? undefined }] : undefined}
        consequences={['Không khôi phục được']}
        okText="Xoá"
        confirmLoading={busy}
        error={removeError}
        onOk={() => {
          if (removing === null) return
          void write(() => deleteNote(removing.id), () => setRemoving(null), setRemoveError)
        }}
        onCancel={() => !busy && setRemoving(null)}
      />

      <ConsequenceModal
        open={leaving !== null}
        tone="warn"
        title={leaving?.title ?? ''}
        consequences={['Nội dung chưa lưu bị mất']}
        okText={leaving?.okText}
        onOk={() => {
          leaving?.then()
          setLeaving(null)
        }}
        onCancel={() => setLeaving(null)}
      />
    </Drawer>
  )
}

function NoteItem({ note, first, busy, editing, onEdit, onEditChange, onCancel, onSave, onDelete }: {
  note: PipingNoteEntry
  first: boolean
  busy: boolean
  /** The text being edited, or null when not editing this note. */
  editing: string | null
  onEdit: () => void
  onEditChange: (body: string) => void
  onCancel: () => void
  onSave: () => void
  onDelete: () => void
}) {
  const type = useTypeScale()
  return (
    <div
      data-testid="piping-note"
      style={{ padding: `${space.md}px 0`, borderTop: first ? undefined : `1px solid ${palette.borderSplit}` }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space.sm }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: space.sm }}>
            <span style={type.bodyStrong}>{note.authorName ?? 'Không rõ người ghi'}</span>
            <span style={{ ...type.caption, color: palette.textTertiary }}>{formatDateTimeVN(note.createdAt)}</span>
          </div>
          {note.updatedBy !== null && (
            <div style={{ ...type.caption, color: palette.textTertiary }}>
              {`Sửa bởi ${note.updatedByName ?? 'Không rõ'} · ${formatDateTimeVN(note.updatedAt)}`}
            </div>
          )}
        </div>
        {editing === null
          ? (
            <Space size={space.xs}>
              <IconAction verb="edit" label="Sửa ghi chú" disabled={busy} onClick={onEdit} />
              <IconAction verb="delete" label="Xoá ghi chú" danger disabled={busy} onClick={onDelete} />
            </Space>
          )
          : (
            <Space size={space.xs}>
              <IconAction
                verb="save"
                label="Lưu ghi chú"
                type="primary"
                disabled={editing.trim() === ''}
                loading={busy}
                onClick={onSave}
              />
              <IconAction verb="close" label="Huỷ sửa" disabled={busy} onClick={onCancel} />
            </Space>
          )}
      </div>
      {editing === null
        ? (
          <div
            data-testid="piping-note-body"
            style={{ ...type.body, marginTop: space.sm, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {note.body}
          </div>
        )
        : (
          <Input.TextArea
            aria-label="Sửa ghi chú"
            style={{ marginTop: space.sm }}
            autoSize={{ minRows: 2, maxRows: 8 }}
            value={editing}
            onChange={(e) => onEditChange(e.target.value)}
          />
        )}
    </div>
  )
}
