import { formatAreaM2 } from '../../lib/format'
import type { MeshCell } from '../../domain/types'
import type { ZoneImpact } from '../../lib/decksApi'
import { ConsequenceModal, type ConsequenceItem } from '../../components/ConsequenceModal'

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
 * The gate every deck-level mesh write goes through, on ConsequenceModal like
 * every other destructive path (I5): the bays and zones affected as items,
 * then what happens, one consequence each.
 *
 * Every claim in here is owned by the list it describes: the dialog can open
 * for any of three independent reasons -- zone impact, progress loss, or a
 * reshape -- in any combination, so no consequence may make a claim about a
 * list that is not on screen. Each item's meta names which list it is in.
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
  const impact = pending?.impact ?? []
  const progressLoss = pending?.progressLoss ?? []
  // Structurally empty when kind === 'delete': a delete never changes a
  // surviving cell's geometry. Reachable, and tested, for 'merge' and 'mesh'.
  const reshaped = pending?.reshaped ?? []
  const wipes = pending?.wipes ?? 0
  const destructive = wipes > 0 || impact.length > 0 || progressLoss.length > 0

  const items: ConsequenceItem[] = [
    ...impact.map((z) => ({ label: `${z.zoneName}: ${z.cellCodes.join(', ')}`, meta: 'rời zone' })),
    ...progressLoss.map((p) => ({ label: `${p.code} — ${p.stageName}`, meta: 'mất tiến độ' })),
    ...reshaped.map((r) => ({
      label: `${r.code} — ${r.stageName}: ${formatAreaM2(r.fromAreaM2)} → ${formatAreaM2(r.toAreaM2)} m²`,
      meta: 'giữ tiến độ',
    })),
  ]
  const consequences = [
    ...(wipes > 0 ? [`Xoá cả ${wipes} ô hiện có của sàn`] : []),
    ...(impact.length > 0 ? ['Ô rời zone ra khỏi zone của nó'] : []),
    ...(progressLoss.length > 0 ? ['Ô mất tiến độ bị xoá tiến độ đã ghi'] : []),
    ...(reshaped.length > 0 ? ['Ô giữ tiến độ đổi diện tích cùng phần trăm hoàn thành'] : []),
    /*
      Unconditional, because it is always true: `apply` writes saveGuides and
      updateDeckArea on every path through this dialog, not only on a mesh
      save. A delete or a merge also commits whatever the admin has done to
      the guide table and the deck-area field, so it is said every time.
    */
    'Lưu cả các đường chia trên bản vẽ và diện tích sàn đang nhập',
  ]

  return (
    <ConsequenceModal
      open={pending !== null}
      tone={destructive ? 'danger' : 'warn'}
      tag={destructive ? 'Thao tác phá huỷ' : 'Xác nhận'}
      title={
        impact.length > 0
          ? 'Thao tác này ảnh hưởng đến zone'
          // Zone impact still wins the title when both apply: it is the one
          // that reaches outside this deck's geometry into a zone's plan. The
          // wipe keeps its own consequence either way.
          : wipes > 0
            ? 'Xoá toàn bộ lưới ô của sàn'
            : 'Xác nhận thay đổi lưới ô'
      }
      description={items.length > 0 ? 'Các ô bị ảnh hưởng:' : undefined}
      items={items}
      consequences={consequences}
      okText={pending ? EDIT_CONFIRM[pending.kind] : undefined}
      confirmLoading={busy}
      onCancel={onCancel}
      onOk={onConfirm}
    />
  )
}
