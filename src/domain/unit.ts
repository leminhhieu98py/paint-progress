/**
 * The quantity a work is measured in -- Feedback Rv6, item 3 (RV6-32…RV6-38).
 *
 * Everything in this product was square metres: `decks.total_area_m2`,
 * `cells.area_m2`, `stage_plans.planned_area_m2`, and about a hundred labels
 * saying `m²`. Linh's item 3: some works are not painted area -- scaffolding
 * is tonnes, cable tray is metres -- and the screens should say so. Her rule
 * (2026-09-15): the unit belongs to the WORK. Every deck in one work shares
 * the work's quantity name and unit, and a deck measured in something else
 * belongs to a different work.
 *
 * That makes item 3 a labelling change and not a model change (RV6-38): the
 * numeric columns keep their `*_m2` names and hold "the quantity in the
 * work's unit", and every weight, share and percentage is a ratio within one
 * deck or one work, so no arithmetic ever mixes units. This module is the one
 * place the labels are built from a work's `quantityLabel` and `unit`, and
 * the one place that decides what a scope of several works may be called.
 */

/** What 0036 gives every existing work. Free text thereafter (Linh, item 2). */
export const DEFAULT_QUANTITY_LABEL = 'Diện tích'
export const DEFAULT_UNIT = 'm²'

/** The heading of a scope whose works do not agree on a quantity (RV6-36). */
export const MIXED_QUANTITY_LABEL = 'Số lượng'
/** The tooltip on a sum that cannot be taken across different units (RV6-36). */
export const MIXED_UNIT_SUM_TOOLTIP = 'Các sàn dùng đơn vị khác nhau, không cộng được'

function shared<K extends string>(items: Record<K, string>[], key: K): string | null {
  if (items.length === 0) return null
  const first = items[0][key]
  return items.every((it) => it[key] === first) ? first : null
}

/**
 * The one unit every work in scope shares; null when they differ or the list
 * is empty. Null is the signal for RV6-36's fallbacks: a `Số lượng` heading
 * with no unit, per-row units, and no sum. Compared as stored -- `m2` and `m²`
 * are two units, because the admin typed two different things.
 */
export const unitOfWorks = (works: { unit: string }[]): string | null => shared(works, 'unit')

/** The one quantity label every work in scope shares, or null. */
export const labelOfWorks = (works: { quantityLabel: string }[]): string | null =>
  shared(works, 'quantityLabel')

/** `Diện tích (m²)` -- the column and field heading. */
export const quantityHeading = (label: string, unit: string): string => `${label} (${unit})`
/** `m²/ngày` -- the KPI chart's left axis and daily series (RV5-27). */
export const rateUnit = (unit: string): string => `${unit}/ngày`
/** `Mhr/m²` -- the efficiency figure of the productivity screens (Rv2, item 12). */
export const perUnit = (unit: string): string => `Mhr/${unit}`
