/**
 * What the KPI filter bar narrows the chart to (FLT-01). The screen holds it,
 * so the project select and these controls sit in one bar under the title.
 */
export const ALL = ''

export interface KpiFilters {
  /** A deck id; ALL is Tất cả sàn. */
  deckId: string
  /** A `coatKey`; ALL is Tất cả công đoạn. */
  coat: string
}

export const DEFAULT_KPI_FILTERS: KpiFilters = { deckId: ALL, coat: ALL }

export const coatKey = (workName: string, stageName: string) => `${workName}\u0000${stageName}`

/** One planned coat, as the Công đoạn options need it. */
export interface PlannedCoat {
  deckId: string
  workName: string
  stageName: string
}

/**
 * The Công đoạn options follow the chosen Sàn (RV5-27's Dự án -> Sàn ->
 * Công đoạn), so picking a deck cannot leave a coat selected that the deck
 * does not have.
 *
 * Keyed on (work, coat) and not on the coat name alone: two works over one
 * deck may carry identically-named coats, and RV5-18 already established
 * that fusing them reads as one coat that does not exist. The label carries
 * the work name only when there is more than one work in view, so the
 * ordinary single-work project reads as a plain list of coats.
 */
export function kpiCoatOptions(coats: PlannedCoat[], deckId: string): { value: string; label: string }[] {
  const inDeck = deckId === ALL ? coats : coats.filter((c) => c.deckId === deckId)
  const works = new Set(inDeck.map((c) => c.workName))
  const seen = new Map<string, string>()
  for (const c of inDeck) {
    const key = coatKey(c.workName, c.stageName)
    if (!seen.has(key)) seen.set(key, works.size > 1 ? `${c.workName} · ${c.stageName}` : c.stageName)
  }
  return [...seen].map(([value, label]) => ({ value, label }))
}

/** The coat actually applied: the chosen one while the deck has it, else ALL. */
export function resolveCoat(coat: string, options: { value: string }[]): string {
  return options.some((c) => c.value === coat) ? coat : ALL
}

/** How many filters are off Tất cả, for the phone's Bộ lọc badge (FLT-04): the deck, the coat. */
export function kpiFilterCount(filters: KpiFilters, coats: { value: string }[]): number {
  return [filters.deckId !== ALL, resolveCoat(filters.coat, coats) !== ALL].filter(Boolean).length
}

/**
 * What is applied, in one line, for the phone's bar (FLT-04): project · deck
 * · coat. A project not known yet is left out rather than guessed.
 */
export function kpiSummary(
  project: string | undefined,
  filters: KpiFilters,
  decks: { id: string; name: string }[],
  coats: { value: string; label: string }[],
): string {
  const deck = decks.find((d) => d.id === filters.deckId)?.name ?? 'Tất cả sàn'
  const coat = coats.find((c) => c.value === resolveCoat(filters.coat, coats))?.label ?? 'Tất cả công đoạn'
  return [project, deck, coat].filter((part) => part !== undefined).join(' · ')
}
