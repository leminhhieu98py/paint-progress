/**
 * Two letters for an avatar, from a Vietnamese full name.
 *
 * A Vietnamese name is surname · middle · given, and the two parts that
 * identify someone in conversation are the FIRST and the LAST -- Nguyễn Thị
 * Linh is NL, not TL. Taking the last two words, which is the usual
 * western-order shortcut, produces the middle name and reads as a different
 * person.
 *
 * Returns '' for a missing name rather than a placeholder glyph: profiles
 * .full_name is nullable, and an empty circle is honest where a made-up letter
 * is not.
 */
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

export function initialsOf(fullName: string): string {
  const parts = nameWords(fullName)
  if (parts.length === 0) return ''
  const first = parts[0]
  const last = parts[parts.length - 1]
  const pair = parts.length === 1 ? first.slice(0, 2) : first[0] + last[0]
  return pair.toUpperCase()
}
