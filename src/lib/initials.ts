/**
 * The words of a name that are a name: a bracketed note ("(demo)", "[test]")
 * dropped, and each word kept to its letters, so punctuation and digits never
 * become an avatar's letter -- "Bùi Quang Huy (demo)" read "B(" (AD2).
 */
export function nameWords(fullName: string): string[] {
  return fullName
    .normalize('NFC')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{M}]/gu, ''))
    .filter(Boolean)
}

/**
 * An avatar's letters, the one rule for every person's avatar -- Nhân lực
 * rows, the admin sidebar, the field account trigger, note authors (AD2, as
 * the owner amended it): the first letter of each of the LAST TWO words of
 * the name, after `nameWords` drops brackets and letterless tokens.
 * "Phạm Đức Long (demo)" is ĐL, "Nguyễn Thị Linh" TL, a one-word "Linh" L.
 * Upper-cased with Vietnamese letters kept (Đ stays Đ).
 *
 * Returns '' for a missing name rather than a placeholder glyph: profiles
 * .full_name is nullable, and an empty circle is honest where a made-up letter
 * is not.
 */
export function initialsOf(fullName: string): string {
  const words = nameWords(fullName)
  return words.slice(-2).map((w) => w[0]).join('').toLocaleUpperCase('vi')
}
