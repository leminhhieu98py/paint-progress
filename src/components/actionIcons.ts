import {
  ArrowRightOutlined, BlockOutlined, CalculatorOutlined, ClearOutlined,
  CloseCircleOutlined, CloseOutlined, ControlOutlined, CopyOutlined, MergeCellsOutlined,
  DeleteOutlined, DownloadOutlined, EditOutlined, ExpandOutlined, EyeInvisibleOutlined, EyeOutlined, LockOutlined,
  MessageOutlined, MinusOutlined, PieChartOutlined, PlusOutlined, RollbackOutlined, SaveOutlined,
  TableOutlined, ThunderboltOutlined, UndoOutlined, UnlockOutlined,
} from '@ant-design/icons'
import type { ComponentType } from 'react'

/**
 * One icon per verb, across the whole app (ACT-01). A new row or inline
 * action takes its verb from here; a verb that needs an icon of its own is
 * added here, never picked on a screen. No icon serves two verbs.
 */
export const ACTION_ICONS = {
  save: SaveOutlined, // Lưu …
  recompute: CalculatorOutlined, // Tự động tính
  resetDefault: UndoOutlined, // Mặc định
  edit: EditOutlined, // Sửa
  delete: DeleteOutlined, // Xoá …
  clear: ClearOutlined, // Xoá toàn bộ lưới ô
  open: ArrowRightOutlined, // Mở (FolderOpen stays the field's Xuất cả dự án)
  duplicate: BlockOutlined, // Nhân bản
  copy: CopyOutlined, // Sao chép mật khẩu
  close: CloseOutlined, // Đóng
  deselect: CloseCircleOutlined, // Bỏ chọn
  shareByArea: PieChartOutlined, // Chia theo m²
  decks: TableOutlined, // Sàn tham gia
  reveal: EyeOutlined, // Xem mật khẩu
  lock: LockOutlined, // Khoá tài khoản
  unlock: UnlockOutlined, // Mở khoá
  hide: EyeInvisibleOutlined, // Ẩn tài khoản
  unhide: RollbackOutlined, // Hiện lại
  detect: ThunderboltOutlined, // Tự động dò ô
  editMode: ControlOutlined, // Hiệu chỉnh ô
  zoomIn: PlusOutlined, // Phóng to
  zoomOut: MinusOutlined, // Thu nhỏ
  fit: ExpandOutlined, // Vừa khung
  notes: MessageOutlined, // Ghi chú (n)
  mergeZone: MergeCellsOutlined, // Gộp thành zone (n)
  template: DownloadOutlined, // Tải file mẫu (Piping imports)
} satisfies Record<string, ComponentType>

export type ActionVerb = keyof typeof ACTION_ICONS
