/**
 * One person, one row on Nhân lực (NL-03, 0037).
 *
 * The database compares names as `lower(btrim(full_name))` -- the rule of
 * `employees_name_key` (0032), which 0037 extends across GS/Visitor accounts
 * and employees. The screen checks the same key before it writes, so the admin
 * sees the clash beside the field; the database remains the one that decides.
 */

/** `lower(btrim(name))`: btrim strips spaces only, so only spaces are trimmed. */
export function personNameKey(name: string): string {
  return name.replace(/^ +| +$/g, '').toLowerCase()
}

/** The SQLSTATE 0037's two triggers raise, with DETAIL `account` or `employee`. */
export const DUPLICATE_PERSON_NAME = 'PPDUP'

/**
 * The admin's sentence for a refused name, or null when the error is not one.
 * 23505 is the employees' own unique index; PPDUP says which list holds the
 * name already.
 */
export function duplicateNameMessage(
  error: { code?: string; message?: string; details?: string | null },
  name: string,
): string | null {
  if (error.code === '23505') return `Đã có nhân viên tên "${name}".`
  if (error.code === DUPLICATE_PERSON_NAME) {
    return error.details === 'account'
      ? `Đã có tài khoản GS/Visitor tên "${name}".`
      : `Đã có nhân viên tên "${name}".`
  }
  return null
}
