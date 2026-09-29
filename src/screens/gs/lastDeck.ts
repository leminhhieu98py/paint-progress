/**
 * The deck last opened in each project, for this browser tab (GS-02).
 *
 * The Sàn tab is the way back from Năng suất and KPI, and GsScreen unmounts on
 * the way out, so the session is what remembers which drawing the foreman was
 * on. sessionStorage, not localStorage: a new tab or a deep link opens on the
 * first deck, as it always has. Every read and write is wrapped, because a
 * browser that refuses storage (a private window, blocked site data) must
 * still open a deck.
 */

export const lastDeckKey = (projectId: string) => `pp:lastDeck:${projectId}`

/** Remembers `deckId` as the last deck opened in `projectId`; a refusal is ignored. */
export function rememberDeck(projectId: string, deckId: string): void {
  try {
    sessionStorage.setItem(lastDeckKey(projectId), deckId)
  } catch {
    // Nothing to remember with; the next visit opens the first deck.
  }
}

/**
 * The deck to open in `projectId`: the remembered one while it is still among
 * `decks`, else the first, else none.
 */
export function openingDeckId(projectId: string, decks: readonly { id: string }[]): string | null {
  let remembered: string | null = null
  try {
    remembered = sessionStorage.getItem(lastDeckKey(projectId))
  } catch {
    remembered = null
  }
  return decks.find((d) => d.id === remembered)?.id ?? decks[0]?.id ?? null
}
