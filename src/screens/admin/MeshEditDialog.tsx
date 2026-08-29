import { Modal, Typography } from 'antd'
import { formatAreaM2 } from '../../lib/format'
import type { MeshCell } from '../../domain/types'
import type { ZoneImpact } from '../../lib/decksApi'
import { modalStyles } from '../../components/modalChrome'

export type EditKind = 'delete' | 'merge' | 'mesh'

const EDIT_CONFIRM: Record<EditKind, string> = {
  delete: 'Vẫn xoá',
  merge: 'Vẫn gộp',
  mesh: 'Vẫn lưu',
}

/** An edit that replaces the deck's cell set, held while the warning is on screen. */
export interface PendingEdit {
  kind: EditKind
  cells: MeshCell[]
  impact: ZoneImpact[]
  inheritFrom: Record<string, string[]>
  /** Cells whose recorded progress this edit discards, with the stage name. */
  progressLoss: { code: string; stageName: string }[]
  /**
   * Cells whose code survives this edit, and whose recorded stage therefore
   * survives with it, but whose area moves by more than
   * CELL_RESHAPE_THRESHOLD -- so the stage's "completed" area quietly
   * grows or shrinks onto a different extent than whoever ticked it signed
   * off on.
   */
  reshaped: { code: string; stageName: string; fromAreaM2: number; toAreaM2: number }[]
  /**
   * How many persisted cells this edit removes when it leaves the deck with no
   * cells at all. Zero unless the result set is empty.
   *
   * Wiping a deck's whole geometry is categorically different from editing it,
   * and it is reachable without any of the disclosures above ever firing: a deck
   * with no progress and no zones has nothing for them to report, so "Chọn tất
   * cả" then "Xoá ô đã chọn" used to delete every row with no confirmation at
   * all.
   */
  wipes: number
}

/**
 * The gate every deck-level mesh write goes through.
 *
 * Split out of DeckEditor because it is 120 lines of prose about consequences
 * and nothing else -- no state, no fetches, no gestures. It reads better beside
 * the shape it describes than buried under the screen's keyboard handling, and
 * the screen it came out of was doing four jobs.
 *
 * Every claim in here is owned by the section that renders it: the dialog can
 * open for any of three independent reasons -- zone impact, progress loss, or a
 * reshape -- in any combination, so no sentence may make a claim about a list
 * it does not own.
 */
export function MeshEditDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: PendingEdit | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={pending !== null}
      destroyOnHidden
      styles={modalStyles}
      title={
        pending &&
        (pending.impact.length > 0
          ? 'Thao tác này ảnh hưởng đến zone'
          // Zone impact still wins the title when both apply: it is the one
          // that reaches outside this deck's geometry into a zone's plan. The
          // wipe still gets its own sentence below either way -- every claim
          // in this dialog is owned by the section that renders it.
          : pending.wipes > 0
            ? 'Xoá toàn bộ lưới ô của sàn'
            : 'Xác nhận thay đổi lưới ô')
      }
      okText={pending ? EDIT_CONFIRM[pending.kind] : undefined}
      cancelText="Huỷ"
      confirmLoading={busy}
      onCancel={onCancel}
      onOk={onConfirm}
    >
      <Typography.Paragraph>
        Kiểm tra các mục dưới đây trước khi xác nhận.
      </Typography.Paragraph>

      {/*
        Unconditional, because it is always true: `apply` writes saveGuides and
        updateDeckArea on every path through this dialog, not only on a mesh
        save. Since A1 collapsed the two save buttons into one, confirming a
        delete or a merge also commits whatever the admin has done to the guide
        table and to the deck-area field -- a guide nudged by accident, or an
        area typed while thinking it over -- with nothing here saying so.

        A conditional version (only when the guides or the area actually
        differ from what was loaded) was rejected: it would need a second
        baseline to diff against, kept in step with the one `cells` already
        has, and a disclosure that is sometimes absent is one more thing to get
        wrong on the dialog whose whole job is to be trusted.
      */}
      <Typography.Paragraph>
        Thao tác này cũng lưu luôn bảng guide và diện tích sàn đang nhập trên
        màn hình — kể cả khi bạn chỉ định xoá hoặc gộp ô.
      </Typography.Paragraph>

      {pending && pending.wipes > 0 && (
        <Typography.Paragraph strong>
          Sau thao tác này sàn sẽ không còn ô nào: {pending.wipes} ô hiện có sẽ bị
          xoá khỏi cơ sở dữ liệu. Muốn kẻ lại lưới thì phải sinh lưới ô mới.
        </Typography.Paragraph>
      )}

      {pending && pending.impact.length > 0 && (
        <>
          <Typography.Paragraph strong>
            Các ô này đang thuộc zone. Xoá hoặc gộp sẽ làm chúng rời khỏi zone:
          </Typography.Paragraph>
          <ul>
            {pending.impact.map((z) => (
              <li key={z.zoneId}>
                <strong>{z.zoneName}</strong>: {z.cellCodes.join(', ')}
              </li>
            ))}
          </ul>
        </>
      )}

      {pending && pending.progressLoss.length > 0 && (
        <>
          <Typography.Paragraph strong>
            Các ô này sẽ mất tiến độ đã ghi:
          </Typography.Paragraph>
          <ul>
            {pending.progressLoss.map((p) => (
              <li key={p.code}>
                <strong>{p.code}</strong> — {p.stageName}
              </li>
            ))}
          </ul>
          {pending.kind === 'merge' && (
            <Typography.Paragraph type="secondary">
              Ô sống sót giữ tiến độ của chính nó. Không có cách gộp nào trung
              thực cho phần còn lại: lấy lớp cao nhất thì báo vượt, lấy lớp thấp
              nhất thì bỏ mất công đã làm.
            </Typography.Paragraph>
          )}
        </>
      )}

      {pending && pending.reshaped.length > 0 && (
        <>
          {/*
            R9: structurally unreachable when kind === 'delete' -- a delete
            never changes a surviving cell's geometry (it only removes
            cells), so `reshaped` is always empty on that path and this
            section can never render there. It is reachable, and covered by
            tests, for 'merge' and 'mesh'. Not dead code: kept intentionally.
          */}
          <Typography.Paragraph strong>
            Các ô này giữ tiến độ đã ghi nhưng diện tích thay đổi, nên phần trăm
            hoàn thành sẽ thay đổi theo:
          </Typography.Paragraph>
          <ul>
            {pending.reshaped.map((r) => (
              <li key={r.code}>
                <strong>{r.code}</strong> — {r.stageName}: {formatAreaM2(r.fromAreaM2)} → {formatAreaM2(r.toAreaM2)} m²
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
