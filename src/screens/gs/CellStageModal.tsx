import { Alert, Button, Input, Modal, Select, Space, Typography } from 'antd'
import { modalProps } from '../../components/modalChrome'
import { palette } from '../../theme'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { isBackwards, nextStage } from '../../domain/stageFlow'
import type { Cell, Stage } from '../../domain/types'
import { formatAreaM2 } from '../../lib/format'
import { listCellNotes, type CellNote } from '../../lib/progressApi'
import { NoteThread } from '../../components/NoteThread'

/**
 * antd's Select cannot carry `null` as an option value (it is indistinguishable
 * from "no selection"), so "not started" needs a sentinel. It never leaves this
 * module: onCommit receives null.
 */
export const NOT_STARTED_VALUE = '__not-started__'

const NOT_STARTED_LABEL = 'Chưa bắt đầu'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong>{children}</Typography.Text>
    </div>
  )
}

export function CellStageModal({
  cell,
  stages,
  open,
  onClose,
  onCommit,
  authorNames = {},
  workName,
}: {
  cell: Cell | null
  stages: Stage[]
  open: boolean
  onClose: () => void
  /**
   * Fire and forget. The caller owns the optimistic update and the rollback, and
   * must not reject: spec §11 row 1 wants the chart to move with no perceptible
   * delay, so this modal closes immediately rather than awaiting the write.
   */
  onCommit: (cellId: string, stageId: string | null, note: string) => void
  /**
   * Full names by user id, for signing notes whose author the tablet cannot
   * read from `profiles`. The screen loads it once per project through
   * `coworker_names()`; empty when that failed, and the thread says so per note.
   */
  authorNames?: Record<string, string>
  /**
   * The work this stage is recorded for (0024). In the title, because a bay
   * now holds one stage per work and "Ô R1C1" alone no longer says which.
   */
  workName?: string
}) {
  const [choice, setChoice] = useState<string>(NOT_STARTED_VALUE)
  const [note, setNote] = useState('')

  // Keyed on the cell's ID only, deliberately. A realtime update to the cell
  // being edited must not silently rewrite the foreman's pending selection --
  // and re-running on every stageId change would do exactly that, including
  // straight after this modal's own optimistic update.
  useEffect(() => {
    setChoice(cell?.stageId ?? NOT_STARTED_VALUE)
    // Reset with the bay, for the same reason and with the same key. This is
    // one component reused for every bay on the deck; left alone, the note
    // typed on R1C1 would be sent as R1C2's, attributing one bay's problem to
    // another.
    //
    // EMPTY, not the bay's existing note. A note belongs to the stage change
    // being recorded: seeding the field meant the foreman recording Coat 2
    // submitted a sentence written about Blast + Coat 1, and the history then
    // showed one problem reported twice against two coats by someone who only
    // meant to tick a box. What is already on the bay is shown above the field
    // instead -- readable, and not the thing being sent.
    setNote('')
  }, [cell?.id])

  /**
   * Every earlier note on this bay (Feedback Rv1, item 7). The foreman used to
   * see only `cell.note` -- the latest -- and the remark that explains why he
   * is standing here may be two coats old.
   *
   * Keyed by the bay id and matched on render rather than reset in the effect:
   * a thread fetched for R1C1 is never shown against R1C2 during the gap
   * before R1C2's own arrives, and there is no synchronous setState to fire a
   * render nobody asked for. Failure is kept apart from "no notes": on screen
   * they look the same, and one of them is a bay with nothing to say.
   */
  const [thread, setThread] = useState<{ cellId: string; notes: CellNote[] } | null>(null)
  const [threadFailedFor, setThreadFailedFor] = useState<string | null>(null)
  const cellId = cell?.id ?? null
  useEffect(() => {
    if (cellId === null) return
    let cancelled = false
    listCellNotes(cellId)
      .then((notes) => {
        if (!cancelled) setThread({ cellId, notes })
      })
      .catch(() => {
        if (!cancelled) setThreadFailedFor(cellId)
      })
    return () => {
      cancelled = true
    }
  }, [cellId])
  const notes = useMemo(() => {
    if (thread === null || thread.cellId !== cellId) return []
    // The author embed is null on a tablet (profiles is behind RLS); the
    // screen's name map fills it. The report copy and the hidden flag (0023)
    // are STRIPPED, not merely left without their buttons: the thread shows
    // them to whoever hands it a note that carries them, and on the tablet the
    // note is what was written, full stop. Caught by the full suite, not by
    // this file's own tests, when the thread learned to render them.
    return thread.notes.map((n) => ({
      ...n,
      byName: n.byName ?? (n.byId !== null ? authorNames[n.byId] ?? null : null),
      reportNote: null,
      reportHidden: false,
      reportEditedByName: null,
      reportEditedAt: null,
    }))
  }, [thread, cellId, authorNames])
  const notesFailed = threadFailedFor !== null && threadFailedFor === cellId

  const ordered = useMemo(() => [...stages].sort((a, b) => a.seq - b.seq), [stages])
  const chosenStageId = choice === NOT_STARTED_VALUE ? null : choice
  const currentStage = stages.find((s) => s.id === cell?.stageId) ?? null
  const next = nextStage(stages, cell?.stageId ?? null)
  const backwards = cell !== null && isBackwards(stages, cell.stageId, chosenStageId)
  const unchanged = cell !== null && chosenStageId === cell.stageId

  return (
    <Modal
      open={open}
      title={cell ? `Ô ${cell.code}${workName ? ` · ${workName}` : ''}` : ''}
      onCancel={onClose}
      onOk={() => {
        if (!cell || unchanged) return
        onCommit(cell.id, chosenStageId, note)
        onClose()
      }}
      okText="Xác nhận"
      cancelText="Huỷ"
      okButtonProps={{ disabled: unchanged, size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
      {...modalProps}
    >
      {cell && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/*
            Grouped under one testid so a test can assert what the INFO rows say
            rather than what the whole modal contains: the Select renders its
            selected option's label, so "Coat 2" appears both here and there, and
            an unscoped query cannot tell which one it found -- it would pass on
            a modal that had lost this row entirely.
          */}
          <div
            data-testid="cell-stage-info"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Field label="Mã ô">{cell.code}</Field>
            <Field label="Diện tích">{formatAreaM2(cell.areaM2)} m²</Field>
            <Field label="Công đoạn hiện tại">{currentStage?.name ?? NOT_STARTED_LABEL}</Field>
            <Field label="Công đoạn tiếp theo">{next?.name ?? 'Đã xong công đoạn cuối'}</Field>
          </div>

          {/*
            One tap for the case that happens all day: advance this bay by one
            stage. Always computed from the cell's CURRENT stage, never from the
            Select -- the two are independent on purpose, so a foreman who opened
            the dropdown to look and then wanted the ordinary next stage is not
            committing whatever they left highlighted. Forward by construction,
            so isBackwards is false on this path and the red warning below
            belongs to the Select.
          */}
          {next && (
            <Button
              type="primary"
              size="large"
              block
              onClick={() => {
                onCommit(cell.id, next.id, note)
                onClose()
              }}
            >
              Xong công đoạn tiếp theo: {next.name}
            </Button>
          )}

          <div>
            <Typography.Text type="secondary">
              {next ? 'Hoặc chọn công đoạn khác' : 'Chọn công đoạn'}
            </Typography.Text>
            <Select
              aria-label="Công đoạn"
              size="large"
              style={{ width: '100%', marginTop: 4 }}
              value={choice}
              onChange={setChoice}
              options={[
                { value: NOT_STARTED_VALUE, label: NOT_STARTED_LABEL },
                ...ordered.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>

          <div>
            {/*
              Optional, and said so. The note explains a delay to somebody who
              is not on the deck -- "bề mặt còn ẩm", "giàn giáo chắn mất một
              góc" -- and a required field on the one write a foreman makes all
              day would be answered with a full stop.

              An id by hand rather than an antd Form field, matching the rest
              of this modal: without one the label is text beside a box, and
              neither a screen reader nor a test can tell which box it belongs
              to.
            */}
            {notes.length > 0 && (
              <div
                data-testid="cell-note-history"
                style={{
                  marginBottom: 12,
                  // Scrolls inside the modal: a five-coat history on a phone
                  // must not push the confirm button off the screen.
                  maxHeight: 240,
                  overflowY: 'auto',
                  padding: '0 13px',
                  borderRadius: 10,
                  background: palette.bgSubtle,
                  border: `1px solid ${palette.borderSplit}`,
                }}
              >
                <NoteThread notes={notes} current={cell.note} />
              </div>
            )}
            {notesFailed && (
              <Typography.Text
                type="secondary"
                style={{ display: 'block', marginBottom: 12, fontSize: 12 }}
              >
                Không tải được ghi chú cũ
              </Typography.Text>
            )}
            <label
              htmlFor="cell-note"
              style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}
            >
              Ghi chú cho quản trị viên{' '}
              <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
                không bắt buộc
              </Typography.Text>
            </label>
            <Input.TextArea
              id="cell-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: bề mặt còn ẩm, hoãn sơn sang mai"
            />
            {note.trim() !== '' && (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {`Ghi chú đi kèm ô ${cell.code} trong lịch sử; quản trị viên thấy ngay trên bản vẽ.`}
              </Typography.Text>
            )}
          </div>

          {backwards && (
            <Alert
              type="error"
              showIcon
              message="Đang chuyển ô về công đoạn trước"
              description="Tiến độ đã ghi của ô này sẽ bị hạ xuống. Chỉ làm khi thực sự cần sửa sai."
            />
          )}
        </Space>
      )}
    </Modal>
  )
}
