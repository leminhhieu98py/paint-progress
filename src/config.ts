/** Obscured base path for every route. Not a security boundary — see spec §7.3. */
export const APP_BASE_PATH = import.meta.env.VITE_APP_BASE_PATH ?? '/w8k3ndx'

/** Supabase Auth requires an email; accounts here log in with a username. */
export const AUTH_EMAIL_SUFFIX = '@app.local'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Maps a login identifier to the email Supabase Auth expects.
 * An identifier already containing `@` is left alone, so a real-email account
 * can be added later without a code change.
 */
export function toAuthEmail(identifier: string): string {
  const normalized = identifier.trim().toLowerCase()
  return normalized.includes('@') ? normalized : `${normalized}${AUTH_EMAIL_SUFFIX}`
}
