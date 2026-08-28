/**
 * Prefix for every route. Empty by default: the app now answers at `/login`.
 *
 * Spec §7.3 put every screen behind an unguessable prefix to reduce casual
 * discovery, and said in the same breath that it "must not be treated as a
 * security boundary" -- Auth and RLS are. Dropping it opens no door; it only
 * makes the app findable, which the admin asked for after having to remember
 * `/w8k3ndx`.
 *
 * The env var stays, so a deployment that wants the obscurity back sets
 * VITE_APP_BASE_PATH and every route moves with it.
 */
export const APP_BASE_PATH = import.meta.env.VITE_APP_BASE_PATH ?? ''

/**
 * Where signing out lands, and the one address worth remembering.
 *
 * Spelled once: the two logout buttons live in screens that share nothing else,
 * and a second literal is a second thing to miss when the base path moves.
 */
export const LOGIN_PATH = `${APP_BASE_PATH}/login`

/** Supabase Auth requires an email; accounts here log in with a username. */
export const AUTH_EMAIL_SUFFIX = '@app.local'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Maps a login identifier to the email Supabase Auth expects.
 *
 * Both branches are trimmed and lower-cased: it absorbs pasted whitespace and a
 * tablet keyboard's auto-capitalisation, and it matches how account creation
 * stores `username`. An identifier containing `@` then skips the suffix, so a
 * real-email account can be added later without a code change.
 */
export function toAuthEmail(identifier: string): string {
  const normalized = identifier.trim().toLowerCase()
  return normalized.includes('@') ? normalized : `${normalized}${AUTH_EMAIL_SUFFIX}`
}

/**
 * The id the deck route uses for a deck that does not exist yet.
 *
 * Here rather than beside the screen that reads it: the deck list needs it to
 * build the link, and importing it from the deck page would pull pdf.js into
 * the list's bundle -- which is also enough to break the list's tests, since
 * pdf.js touches DOMMatrix at import time.
 */
export const NEW_DECK = 'new'
