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
/*
  Two, like everything else on screen.

  Weights were shown to four, because `deck_stages.weight` stores five and a
  three-way split lands on 0,33333 -- so four digits was an attempt to make the
  displayed numbers add up to the displayed total. It never worked: 0,3333 x 3
  reads as 0,9999 beside a total printed as 1,0000, which is worse than
  rounding, because it looks like an error the admin has to find.

  Two everywhere means a split reads 0,33 + 0,33 + 0,33 against a total of
  1,00. The stored value is untouched -- the input still accepts and keeps five
  decimals, and `balanced` still checks the real sum against 1 to five places.
  This is the display, and the display is for reading.
*/
const WEIGHT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Man-hours: one decimal always ("3,0"), a second when it carries information ("0,25"). */
const HOURS = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
/** Mhr/m²: three places, since the customer's workbook compares 1,149 with 1,161. */
const MHR_PER_M2 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

export const formatAreaM2 = (n: number): string => AREA_M2.format(n)
export const formatPercent = (n: number): string => PERCENT.format(n)
export const formatWeight = (n: number): string => WEIGHT.format(n)
export const formatHours = (n: number): string => HOURS.format(n)
export const formatMhrPerM2 = (n: number): string => MHR_PER_M2.format(n)

/**
 * Vietnam is UTC+7 all year and has been since 1975 -- no daylight saving, no
 * historical shift inside any range this product will ever hold. So the offset
 * is a constant rather than an Intl timezone lookup, which keeps this pure and
 * testable and removes a whole class of "works on my machine" from a file that
 * a customer reads.
 */
const VN_OFFSET_MINUTES = 7 * 60

/**
 * A recorded moment, in the form the paperwork uses: `hh:mm:ss dd/mm/yyyy`.
 *
 * Time first, because on a deck the question is almost always "when today",
 * and the date is the part that repeats down the column.
 *
 * Returns an empty string for a missing or unparseable value rather than
 * "Invalid Date": these come from `cells.updated_at`, which is null on a bay
 * nobody has touched, and a blank cell reads as "never" without needing a
 * legend.
 */
export function formatDateTimeVN(iso: string | null | undefined): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const vn = new Date(at.getTime() + VN_OFFSET_MINUTES * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}:${p(vn.getUTCSeconds())} `
    + `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`
  )
}

/**
 * The same moment as a Date whose UTC parts ARE the Vietnam wall clock.
 *
 * For spreadsheet cells. Excel has no concept of a timezone: it stores a serial
 * number and renders it verbatim, and ExcelJS derives that serial from the
 * Date's UTC value. So a Date built from real UTC would display seven hours
 * early on every machine that opens the file. Shifting first makes the rendered
 * cell say Vietnam time, and -- unlike writing a preformatted string -- the
 * cell stays a real date, so sorting and filtering the column still work.
 */
export function toVNExcelDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return new Date(at.getTime() + VN_OFFSET_MINUTES * 60_000)
}
