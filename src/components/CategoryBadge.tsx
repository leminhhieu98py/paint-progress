import { CATEGORY_TONE, type Category, type CategoryValue } from './categoryTone'
import { StatusPill, type StatusTone } from './StatusPill'

/**
 * A value drawn from a small fixed set reads as a coloured badge (UI-04), so
 * a column of them can be scanned without reading every word. A value outside
 * the set falls back to the grey `off` tone rather than throwing, since a
 * stale row must still render.
 *
 * Editable cells keep their Select or Switch; this is for read-only cells.
 * `value` is typed by the category, so a screen label renamed away from the
 * map is a type error rather than a silent grey badge.
 */
export function CategoryBadge<C extends Category>({ category, value }: { category: C; value: CategoryValue<C> }) {
  const tones: Record<string, StatusTone> = CATEGORY_TONE[category]
  return <StatusPill tone={tones[value] ?? 'off'}>{value}</StatusPill>
}
