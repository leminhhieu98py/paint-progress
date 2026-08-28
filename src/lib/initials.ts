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
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const first = parts[0]
  const last = parts[parts.length - 1]
  const pair = parts.length === 1 ? first.slice(0, 2) : first[0] + last[0]
  return pair.toUpperCase()
}
