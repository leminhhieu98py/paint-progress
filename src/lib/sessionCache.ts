/**
 * Reads kept for the length of one signed-in session.
 *
 * A module that caches something one account may see registers how to forget
 * it; AuthProvider calls `endSession` whenever the signed-in account changes
 * (sign-out, or another account signing in), so nothing one account read is
 * ever shown to the next. It lives apart from the caches themselves so that
 * AuthProvider, which the login form loads, imports none of them.
 */
const clears = new Set<() => void>()

/** Registers `clear` to run at the end of every session. */
export function onSessionEnd(clear: () => void): void {
  clears.add(clear)
}

/** Forgets everything registered: the account on this tab has changed. */
export function endSession(): void {
  for (const clear of clears) clear()
}
