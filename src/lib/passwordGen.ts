/**
 * The shortest password this app will store.
 *
 * Twelve, not the platform default of six. The admin types this by hand to hand
 * to a foreman over a radio, and a GS account that is guessed can write
 * `cells.stage_id` -- the numbers the customer is billed against. Six
 * characters with no character-class requirement is `gs2024`.
 */
export const MIN_PASSWORD_LENGTH = 12

/**
 * Words a password is built from.
 *
 * Vietnamese, unaccented, and chosen to be unambiguous when read out over a
 * radio on a platform: no pair here sounds alike, none is a homophone of a
 * number, and every one survives being spelled letter by letter. Deliberately
 * NOT drawn from the domain -- no `son`, `deck`, `bachho` -- because the first
 * thing anyone guesses is the thing they are looking at.
 */
const WORDS = [
  'bien', 'canh', 'dao', 'gio', 'hoa', 'khoi', 'lua', 'mua',
  'nui', 'ngoi', 'phao', 'quat', 'rung', 'sao', 'tau', 'thuyen',
  'trang', 'vang', 'xanh', 'yen', 'bong', 'cua', 'dua', 'ganh',
  'hang', 'kinh', 'lam', 'may', 'nam', 'ong', 'pha', 'song',
] as const

/**
 * How many words. Four from a 32-word list is 20 bits, which is weak on its
 * own -- the two digits and the separators are what carry this past the length
 * floor, and the platform's own 30-attempts-per-5-minutes-per-IP limit is what
 * makes online guessing hopeless. This is a password handed over in person for
 * a private tool, not a public sign-up.
 */
const WORD_COUNT = 4

/**
 * A password nobody had to invent.
 *
 * A rule the admin has to satisfy is a rule the admin works around -- they will
 * find the shortest string that passes and use it on every account. Not asking
 * them to think of one at all is the fix; this is long, typo-proof when spelled
 * out, and looks nothing like the site name.
 *
 * `crypto.getRandomValues`, never `Math.random`: this is a credential, and
 * Math.random is seeded predictably enough that two accounts made in the same
 * session could be related.
 */
export function generatePassword(): string {
  const picks = new Uint32Array(WORD_COUNT + 1)
  crypto.getRandomValues(picks)
  const words = Array.from(picks.slice(0, WORD_COUNT), (n) => WORDS[n % WORDS.length])
  // Two digits on the end, so the result clears MIN_PASSWORD_LENGTH even in the
  // worst case (four three-letter words plus separators is 15) and satisfies a
  // digit requirement wherever one is configured.
  const digits = String(picks[WORD_COUNT] % 100).padStart(2, '0')
  return `${words.join('-')}-${digits}`
}
