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

/**
 * The SQLSTATE 0037's two triggers raise. DETAIL names who holds the name:
 * `account`, `hidden_account`, `employee` or `retired_employee`.
 */
export const DUPLICATE_PERSON_NAME = 'PPDUP'

export type NameHolder = 'account' | 'hidden_account' | 'employee' | 'retired_employee'

/**
 * "Already on the list", saying so when the holder is out of the default
 * view -- a hidden account or a retired employee -- and how to see it.
 */
export function nameTakenMessage(name: string, holder: NameHolder): string {
  switch (holder) {
    case 'account': return `Đã có tài khoản GS/Visitor tên "${name}".`
    case 'hidden_account': return `Đã có tài khoản GS/Visitor tên "${name}" (đã ẩn; chọn Trạng thái «Đã ẩn» để thấy).`
    case 'employee': return `Đã có nhân viên tên "${name}".`
    case 'retired_employee': return `Đã có nhân viên tên "${name}" (đã nghỉ; chọn Trạng thái «Đã nghỉ» để thấy).`
  }
}

/**
 * The admin's sentence for a refused name, or null when the error is not one.
 * 23505 is the employees' own unique index; PPDUP says which list holds the
 * name already.
 */
export function duplicateNameMessage(
  error: { code?: string; message?: string; details?: string | null },
  name: string,
): string | null {
  if (error.code === '23505') return nameTakenMessage(name, 'employee')
  if (error.code === DUPLICATE_PERSON_NAME) {
    const holder = (['account', 'hidden_account', 'employee', 'retired_employee'] as const)
      .find((h) => h === error.details) ?? 'employee'
    return nameTakenMessage(name, holder)
  }
  return null
}
