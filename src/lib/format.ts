/**
 * Vietnamese number formatting, in one place.
 *
 * Every screen used to declare its own `Intl.NumberFormat('vi-VN', ...)` --
 * seven instances across four files (DeckEditor, DecksScreen, ProjectsScreen,
 * StageConfigPanel) -- and the two `percent` ones disagreed: DeckEditor used
 * 1 fraction digit, ProjectsScreen used 2, so the exact same ratio rendered
 * "48,5%" in one screen and "48,46%" in the other. One module, one instance
 * per shape, every screen imports from here instead of declaring its own.
 *
 * Percent is standardised on 2 fraction digits, not 1: ProjectsScreen's own
 * use is the project's overall progress -- the customer-facing headline
 * number this whole review exists to protect -- and domain/progress.ts
 * computes it to 1e-9 against the customer's own spreadsheet, so showing only
 * 1 decimal throws away precision that is already there for free.
 * DeckEditor's area-divergence banner moves to match; it is a secondary
 * diagnostic for the admin, not the number that disagreeing would put in
 * front of the customer.
 */

const AREA_M2 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PERCENT = new Intl.NumberFormat('vi-VN', {
  style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
/**
 * Millimetre coordinates group as 58.100, like every other number on screen.
 *
 * Two fraction digits, not zero: `deck_guides.offset_mm` is `numeric(12,2)` and
 * the span field accepts "14500,5", so at maximumFractionDigits 0 the "Toạ độ
 * thật (mm)" column rendered a typed 14500,5 as "14.501". No number was wrong --
 * the areas use the raw value -- but the admin could not read back what they
 * had entered, on the one column that exists to be checked against the drawing.
 *
 * minimumFractionDigits stays 0 so whole millimetres, which is nearly all of
 * them, still render as "14.500" rather than "14.500,00" -- padding every offset
 * with two zeroes to accommodate the rare half-millimetre would make the column
 * harder to scan, not easier.
 */
const MM = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 0, maximumFractionDigits: 2,
})
const WEIGHT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })

export const formatAreaM2 = (n: number): string => AREA_M2.format(n)
export const formatPercent = (n: number): string => PERCENT.format(n)
export const formatMm = (n: number): string => MM.format(n)
export const formatWeight = (n: number): string => WEIGHT.format(n)
