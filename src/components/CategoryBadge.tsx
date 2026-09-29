import { CATEGORY_TONE, wasteReasonTone, type Category } from './categoryTone'
import { StatusPill, type StatusTone } from './StatusPill'

/**
 * A value drawn from a small fixed set reads as a coloured badge (UI-04), so
 * a column of them can be scanned without reading every word. A value outside
 * the set falls back to the grey `off` tone rather than throwing, since a
 * stale row must still render.
 *
 * Editable cells keep their Select or Switch; this is for read-only cells.
 */
export function CategoryBadge({ category, value }: { category: Category; value: string }) {
  const tones: Record<string, StatusTone> = CATEGORY_TONE[category]
  return <StatusPill tone={tones[value] ?? 'off'}>{value}</StatusPill>
}

/** The whole reason, coloured by its group; nothing at all for an empty one. */
export function WasteReasonBadge({ reason }: { reason: string }) {
  const text = reason.trim()
  if (text === '') return null
  return <StatusPill tone={wasteReasonTone(text)}>{text}</StatusPill>
}
