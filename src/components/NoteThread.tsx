import { Button } from 'antd'
import dayjs from 'dayjs'
import { EmptyState } from './EmptyState'
import { initialsOf } from '../lib/initials'
import type { CellNote } from '../lib/progressApi'
import { palette } from '../theme'

/**
 * Every note left on one bay, as a thread.
 *
 * A bay is ticked once per coat and can carry a remark each time, so "the note"
 * was never one thing -- the panel used to print `cells.note`, which is
 * whichever remark happened to be written last, with nothing saying it was the
 * third of three or what the first two said about the bay being paid for.
 *
 * Shaped after a spreadsheet's comment thread, with two departures the domain
 * asks for:
 *
 *   - Newest first. A chat is read forwards because the end is the point; here
 *     each note belongs to a coat, and the coat being acted on is the last one.
 *     Making the admin scroll a five-coat history to reach it is backwards.
 *   - Every entry names its coat. In a spreadsheet a comment thread is about
 *     one cell in one state; here the state is the subject -- "Bề mặt còn ẩm"
 *     against Blast + Coat 1 and against Tháo giáo are different problems.
 *
 * The report copy (0023) is shown as a second thing under the original, never
 * in its place: the foreman's sentence is the record, the admin's version is
 * what the XLSX prints, and both carry who set them. The two actions render
 * only when their handlers are passed -- the GS modal and the admin's Xem
 * mode call this without them, and neither may write.
 */
export function NoteThread({
  notes,
  current,
  onEditReport,
  onToggleHidden,
}: {
  notes: CellNote[]
  current?: string
  onEditReport?: (note: CellNote) => void
  onToggleHidden?: (note: CellNote) => void
}) {
  /** "Đoàn Công Linh · 02.09.2026 10:00" -- who last touched the report copy. */
  const stamp = (n: CellNote) =>
    [
      n.reportEditedByName ?? 'Không rõ',
      n.reportEditedAt ? dayjs(n.reportEditedAt).format('DD.MM.YYYY HH:mm') : null,
    ].filter(Boolean).join(' · ')
  if (notes.length === 0) {
    return (
      <EmptyState
        title="Ô này chưa có ghi chú nào"
        description="GS ghi chú khi ghi công đoạn trên máy tính bảng. Ghi chú sẽ hiện ở đây kèm công đoạn, người ghi và thời điểm."
      />
    )
  }

  return (
    <div data-testid="note-thread" style={{ display: 'flex', flexDirection: 'column' }}>
      {notes.map((n, i) => {
        /*
          The one the drawing's flag and `cells.note` are showing. Matched on
          the text of the newest entry rather than assumed to be index 0: a
          stage change that cleared the note leaves `cells.note` empty while the
          history still holds older remarks, and marking one of those "current"
          would be a lie about what the bay says now.
        */
        const isCurrent = i === 0 && current !== undefined && current.trim() === n.note
        return (
          <div
            key={n.id}
            style={{
              display: 'flex',
              gap: 12,
              padding: '14px 0',
              borderTop: i === 0 ? undefined : `1px solid ${palette.borderSplit}`,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 32,
                height: 32,
                flex: 'none',
                borderRadius: 10,
                background: palette.bgHover,
                color: palette.textSecondary,
                fontSize: 12,
                fontWeight: 600,
                lineHeight: '32px',
                textAlign: 'center',
              }}
            >
              {initialsOf(n.byName ?? '?')}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 9,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {n.byName ?? 'Không rõ người ghi'}
                </span>
                <span style={{ fontSize: 12, color: palette.textTertiary }}>
                  {dayjs(n.at).format('DD.MM.YYYY HH:mm')}
                </span>
                {isCurrent && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: 1,
                      padding: '4px 8px',
                      borderRadius: 999,
                      background: palette.accentTint,
                      color: palette.accent,
                    }}
                  >
                    Đang hiện trên bản vẽ
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 7,
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  textWrap: 'pretty',
                  // Dimmed, not removed: the note is still what was said.
                  color: n.reportHidden ? palette.textTertiary : undefined,
                }}
              >
                {n.note}
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1,
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: palette.bgSubtle,
                    border: `1px solid ${palette.borderSplit}`,
                    color: palette.textSecondary,
                  }}
                >
                  {/* The work and the coat this note was recorded against,
                      which together are the subject of it: two works can note
                      one bay (0024). A null to_stage_name is a bay put back to
                      "not started", which is itself worth saying. */}
                  {[n.workName, n.stageName ?? 'Trả về chưa bắt đầu'].filter(Boolean).join(' · ')}
                </span>
                {n.reportHidden && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: 1,
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: palette.warningBg,
                      color: palette.warning,
                    }}
                  >
                    {`Ẩn khỏi báo cáo · ${stamp(n)}`}
                  </span>
                )}
              </div>
              {n.reportNote !== null && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: palette.accentTint,
                    borderLeft: `3px solid ${palette.accent}`,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: palette.accent }}>
                    Bản cho báo cáo
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      textWrap: 'pretty',
                    }}
                  >
                    {n.reportNote}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: palette.textTertiary }}>
                    {`Sửa bởi ${stamp(n)}`}
                  </div>
                </div>
              )}
              {(onEditReport || onToggleHidden) && (
                <div style={{ marginTop: 8, display: 'flex', gap: 4, marginLeft: -8 }}>
                  {onEditReport && (
                    <Button type="link" size="small" onClick={() => onEditReport(n)}>
                      Sửa cho báo cáo
                    </Button>
                  )}
                  {onToggleHidden && (
                    <Button type="link" size="small" onClick={() => onToggleHidden(n)}>
                      {n.reportHidden ? 'Hiện lại trong báo cáo' : 'Ẩn khỏi báo cáo'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
