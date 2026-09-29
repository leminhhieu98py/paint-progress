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

/**
 * Waste reasons are `<group>.<n> <text>` (domain/effort.ts, 26 of them in 8
 * groups). The palette offers six AA-safe badge tones, so the colour follows
 * the GROUP, and two pairs of groups share: 5 (people) with 6 (rework) as the
 * crew's own causes, 7 (housekeeping) with 8 (weather, outages) as outside
 * causes. A reason without a leading group digit gets the grey tone.
 */
const WASTE_GROUP_TONE: Record<string, StatusTone> = {
  '1': 'slate',
  '2': 'warn',
  '3': 'accent',
  '4': 'ok',
  '5': 'error',
  '6': 'error',
  '7': 'off',
  '8': 'off',
}

export function wasteReasonTone(reason: string): StatusTone {
  const group = /^(\d)\./.exec(reason.trim())?.[1]
  return (group !== undefined && WASTE_GROUP_TONE[group]) || 'off'
}
