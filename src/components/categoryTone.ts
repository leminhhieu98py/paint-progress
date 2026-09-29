import type { StatusTone } from './StatusPill'

/**
 * Which tone each value of a small fixed set gets (UI-04), keyed by the label
 * the screen already shows. `CategoryBadge` renders these; they live apart
 * from it so the maps can be imported without a component in the way.
 */
export const CATEGORY_TONE = {
  // Visitor is a role, not an absence: its own colour, never the grey of
  // Đã ẩn, Đã nghỉ or Không (M15).
  role: { 'Nhân viên': 'slate', GS: 'accent', Visitor: 'info' },
  accountStatus: { 'Đang dùng': 'ok', 'Đã khoá': 'warn', 'Đã ẩn': 'off' },
  // Nhân lực (NL-01): an employee's Trạng thái, in the same column as an account's.
  employeeStatus: { 'Đang làm': 'ok', 'Đã nghỉ': 'off' },
  workKind: { 'Theo ô': 'accent', 'Nhập tay': 'slate' },
  counts: { Có: 'ok', Không: 'off' },
  drawing: { 'Đã có': 'ok', 'Chưa có': 'warn' },
} as const satisfies Record<string, Record<string, StatusTone>>

export type Category = keyof typeof CATEGORY_TONE

/** The labels a category knows, e.g. `'GS' | 'Visitor'` for `role`. */
export type CategoryValue<C extends Category> = C extends Category ? keyof (typeof CATEGORY_TONE)[C] & string : never
