import {
  ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined, CalculatorOutlined, ClearOutlined, CloseCircleOutlined, CloseOutlined,
  ControlOutlined, CopyOutlined, DeleteOutlined, EditOutlined, ExpandOutlined, EyeInvisibleOutlined,
  EyeOutlined, FormOutlined, KeyOutlined, LockOutlined, MinusOutlined, PieChartOutlined,
  PlusOutlined, RollbackOutlined, SaveOutlined, ScheduleOutlined, SwapOutlined, TableOutlined, TeamOutlined,
  ThunderboltOutlined, UndoOutlined, UnlockOutlined,
} from '@ant-design/icons'
import type { ComponentType } from 'react'

/**
 * One icon per verb, across the whole app (ACT-01). A new row or inline
 * action takes its verb from here; a verb that needs an icon of its own is
 * added here, never picked on a screen. No icon serves two verbs.
 */
export const ACTION_ICONS = {
  save: SaveOutlined, // Lưu …
  recompute: CalculatorOutlined, // Tự tính
  resetDefault: UndoOutlined, // Mặc định
  edit: EditOutlined, // Sửa
  rename: FormOutlined, // Đổi tên đăng nhập
  delete: DeleteOutlined, // Xoá …
  clear: ClearOutlined, // Xoá toàn bộ lưới ô
  open: ArrowRightOutlined, // Mở (FolderOpen stays the field's Xuất cả dự án)
  duplicate: CopyOutlined, // Nhân bản
  moveUp: ArrowUpOutlined, // Lên
  moveDown: ArrowDownOutlined, // Xuống
  close: CloseOutlined, // Đóng
  deselect: CloseCircleOutlined, // Bỏ chọn
  shareByArea: PieChartOutlined, // Chia theo m²
  members: TeamOutlined, // Dự án và công việc
  decks: TableOutlined, // Sàn tham gia
  password: KeyOutlined, // Đổi mật khẩu
  reveal: EyeOutlined, // Xem mật khẩu
  lock: LockOutlined, // Khoá tài khoản
  unlock: UnlockOutlined, // Mở khoá
  hide: EyeInvisibleOutlined, // Ẩn tài khoản
  unhide: RollbackOutlined, // Hiện lại
  changeRole: SwapOutlined, // Đổi phân quyền
  detect: ThunderboltOutlined, // Tự động dò ô
  editMode: ControlOutlined, // Hiệu chỉnh ô
  zoomIn: PlusOutlined, // Phóng to
  zoomOut: MinusOutlined, // Thu nhỏ
  fit: ExpandOutlined, // Vừa khung
  plan: ScheduleOutlined, // Hiện kế hoạch
} satisfies Record<string, ComponentType>

export type ActionVerb = keyof typeof ACTION_ICONS
