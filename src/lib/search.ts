/**
 * Matching a Vietnamese name the way a person types it into a search box.
 *
 * The roster stores "MC005593 - Cao Minh Hải", and whoever is looking for that
 * line types "hai", or "cao minh", or the code -- on a site tablet, usually
 * without tones. So both sides are folded before they are compared: NFD splits
 * "ả" into "a" plus U+0309, and dropping the U+0300-U+036F combining block
 * leaves the bare letter.
 *
 * Đ/đ is mapped by hand because it has no combining form -- U+0111 does not
 * decompose, so "Đoàn" would stay unreachable from "doan" while every other
 * Vietnamese letter matched.
 *
 * Substring, not prefix: "Hải" is the part of "MC005593 - Cao Minh Hải" that a
 * human actually remembers.
 */
export function foldForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
}

/**
 * True when `needle` appears anywhere in `haystack`, ignoring case and tones.
 *
 * An empty or whitespace-only needle matches everything: a search box that has
 * been cleared must show the whole list again, not none of it.
 */
export function matchesSearch(haystack: string, needle: string): boolean {
  const q = foldForSearch(needle).trim()
  return q === '' || foldForSearch(haystack).includes(q)
}
