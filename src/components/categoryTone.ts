import type { StatusTone } from './StatusPill'

/**
 * Which tone each value of a small fixed set gets (UI-04), keyed by the label
 * the screen already shows. `CategoryBadge` renders these; they live apart
 * from it so the maps can be imported without a component in the way.
 */
export const CATEGORY_TONE = {
  role: { GS: 'accent', 'Chỉ xem': 'off' },
  accountStatus: { 'Đang dùng': 'ok', 'Đã khoá': 'warn', 'Đã ẩn': 'off' },
  workKind: { 'Theo ô': 'accent', 'Nhập tay': 'slate' },
  counts: { Có: 'ok', Không: 'off' },
  drawing: { 'Đã có': 'ok', 'Chưa có': 'warn' },
} as const satisfies Record<string, Record<string, StatusTone>>

export type Category = keyof typeof CATEGORY_TONE
