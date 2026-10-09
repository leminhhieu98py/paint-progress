/**
 * The longest list a Piping dialog renders as plain lines (warnings): a
 * 20 000-row file can raise thousands, which would push the diff and the
 * danger lines far down. The rest is counted ("và N cảnh báo khác").
 */
export const MAX_LISTED = 200

export function capList<T>(items: T[], max = MAX_LISTED): { shown: T[]; more: number } {
  return items.length <= max
    ? { shown: items, more: 0 }
    : { shown: items.slice(0, max), more: items.length - max }
}
