import { initialsOf as nameInitials } from '../../lib/initials'

/**
 * The field account trigger's letters: the shared avatar rule on the full
 * name (AD2), or the login's first letter when there is no name, else "?".
 */
export function initialsOf(fullName: string, username: string): string {
  const fromName = nameInitials(fullName)
  if (fromName !== '') return fromName
  const text = (username.trim()[0] ?? '').toLocaleUpperCase('vi')
  return text === '' ? '?' : text
}
