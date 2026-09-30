import { nameWords } from '../../lib/initials'

/**
 * The avatar's letters: the first letter of the first and of the last word of
 * the full name, or of the login when there is no name.
 */
export function initialsOf(fullName: string, username: string): string {
  // Letters only, a bracketed note dropped (AD2).
  const words = nameWords(fullName)
  const letters = words.length === 0
    ? [username.trim()[0]]
    : words.length === 1 ? [words[0][0]] : [words[0][0], words[words.length - 1][0]]
  const text = letters.filter(Boolean).join('').toLocaleUpperCase('vi')
  return text === '' ? '?' : text
}
