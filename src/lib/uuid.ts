/**
 * A v4 uuid, minted client side, that works over plain http.
 *
 * `crypto.randomUUID` requires a secure context (https, or localhost) -- and
 * this admin app has no promise of being served over https. A site office on
 * a bare HTTP LAN IP is entirely plausible, and there `crypto.randomUUID` is
 * simply not a function: whatever needed an id throws, with nothing on screen
 * to explain why.
 *
 * `crypto.getRandomValues` carries no such restriction, so it is the fallback
 * here, building a v4 UUID by hand from 16 random bytes. `randomUUID` stays
 * the preferred path wherever it exists. The global is read at call time, so a
 * test can stand in for an insecure context by stubbing it.
 *
 * Two callers, for the same reason in both: a row's identity has to exist
 * before the row is ever written, because the write is an upsert keyed on that
 * id. StageConfigPanel mints one when the admin adds a stage; DeckEditor mints
 * one when the admin adds a guide.
 */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
