import type { CategoryValue } from '../../components/categoryTone'
import type { AccountRole, GsUser, StaffRole } from '../../lib/adminApi'
import type { Employee } from '../../lib/employeesApi'
import { nameTakenMessage, personNameKey } from '../../lib/personName'
import { matchesSearch } from '../../lib/search'

/**
 * Nhân lực (NL-01): GS/Visitor accounts and employees as one list. The two
 * tables stay what they are -- an account signs in, an employee is a name the
 * foreman picks -- and this file is how the screen lays them side by side.
 */

/** The Phân quyền badge; the database keeps `viewer` for Visitor. */
export const ROLE_LABEL = {
  employee: 'Nhân viên',
  gs: 'GS',
  viewer: 'Visitor',
} as const satisfies Record<StaffRole, CategoryValue<'role'>>

/**
 * What each Phân quyền means, in one sentence: the create dialog's helper and
 * the list's Quy tắc áp dụng read these same strings (owner, NL-02).
 */
export const ROLE_DESCRIPTION: Record<StaffRole, string> = {
  employee: 'Nhân viên không đăng nhập; GS chọn họ làm nhóm trưởng hoặc thợ chính khi ghi tiến độ và không sửa được danh sách.',
  gs: 'GS đăng nhập trên tablet và ghi tiến độ ở các dự án được gán.',
  viewer: 'Visitor đăng nhập, xem mọi dự án và mọi công việc, tải được báo cáo nhưng không ghi được gì.',
}

export type StaffStatus = CategoryValue<'accountStatus'> | CategoryValue<'employeeStatus'>

interface RowBase {
  /** `kind:id`: the two tables' ids never meet, but the key must not depend on it. */
  key: string
  id: string
  fullName: string
  status: StaffStatus
}

export type StaffRow =
  | (RowBase & { kind: 'account'; role: AccountRole; status: CategoryValue<'accountStatus'>; account: GsUser })
  | (RowBase & { kind: 'employee'; role: 'employee'; status: CategoryValue<'employeeStatus'>; employee: Employee })

const statusOfAccount = (a: GsUser): CategoryValue<'accountStatus'> => (a.hidden ? 'Đã ẩn' : a.active ? 'Đang dùng' : 'Đã khoá')

/** Both lists, one row per person, by full name in Vietnamese order. */
export function buildRows(accounts: GsUser[], employees: Employee[]): StaffRow[] {
  const rows: StaffRow[] = [
    ...accounts.map((a): StaffRow => ({
      key: `account:${a.id}`, kind: 'account', id: a.id, fullName: a.fullName, role: a.role,
      status: statusOfAccount(a), account: a,
    })),
    ...employees.map((e): StaffRow => ({
      key: `employee:${e.id}`, kind: 'employee', id: e.id, fullName: e.fullName, role: 'employee',
      status: e.active ? 'Đang làm' : 'Đã nghỉ', employee: e,
    })),
  ]
  return rows.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi') || a.key.localeCompare(b.key))
}

/** `listed`: everyone but hidden accounts and retired employees -- the default. */
export type StatusFilter = 'listed' | 'all' | StaffStatus
export type RoleFilter = 'all' | StaffRole

export interface StaffFilters {
  query: string
  role: RoleFilter
  status: StatusFilter
}

export const DEFAULT_FILTERS: StaffFilters = { query: '', role: 'all', status: 'listed' }

export const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả phân quyền' },
  { value: 'employee', label: ROLE_LABEL.employee },
  { value: 'gs', label: ROLE_LABEL.gs },
  { value: 'viewer', label: ROLE_LABEL.viewer },
]

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'listed', label: 'Trừ đã ẩn, đã nghỉ' },
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'Đang dùng', label: 'Đang dùng' },
  { value: 'Đang làm', label: 'Đang làm' },
  { value: 'Đã khoá', label: 'Đã khoá' },
  { value: 'Đã nghỉ', label: 'Đã nghỉ' },
  { value: 'Đã ẩn', label: 'Đã ẩn' },
]

const OUT_OF_LIST: StaffStatus[] = ['Đã ẩn', 'Đã nghỉ']

export function filterRows(rows: StaffRow[], f: StaffFilters): StaffRow[] {
  return rows.filter((r) => {
    if (f.role !== 'all' && r.role !== f.role) return false
    if (f.status === 'listed' && OUT_OF_LIST.includes(r.status)) return false
    if (f.status !== 'listed' && f.status !== 'all' && r.status !== f.status) return false
    return matchesSearch(r.fullName, f.query) || (r.kind === 'account' && matchesSearch(r.account.username, f.query))
  })
}

export const isFiltered = (f: StaffFilters) =>
  f.query.trim() !== '' || f.role !== DEFAULT_FILTERS.role || f.status !== DEFAULT_FILTERS.status

/** The counts beside the title: what is on screen, or how much of the whole a filter kept. */
export function countsLine(all: StaffRow[], shown: StaffRow[], filtered: boolean): string {
  if (filtered) return `${shown.length}/${all.length} dòng khớp bộ lọc`
  const accounts = shown.filter((r) => r.kind === 'account').length
  return `${accounts} tài khoản · ${shown.length - accounts} nhân viên`
}

/**
 * The inline error for a name the database would refuse (0037), or null. An
 * account's name may match no other account, hidden included, and no
 * employee; an employee's may match no employee and no visible account. The
 * database decides; this only says it before the round trip.
 */
export function nameClash(rows: StaffRow[], name: string, target: 'employee' | 'account', exceptKey?: string): string | null {
  const key = personNameKey(name)
  if (key === '') return null
  const shown = name.trim()
  const same = rows.filter((r) => r.key !== exceptKey && personNameKey(r.fullName) === key)
  const employees = same.filter((r) => r.kind === 'employee')
  if (employees.length > 0) {
    return nameTakenMessage(shown, employees.some((r) => r.status === 'Đang làm') ? 'employee' : 'retired_employee')
  }
  const accounts = same.filter((r) => r.kind === 'account')
  const visible = accounts.filter((r) => r.status !== 'Đã ẩn')
  if (visible.length > 0) return nameTakenMessage(shown, 'account')
  // A hidden account blocks a new account, never an employee (0037, A1).
  return target === 'account' && accounts.length > 0 ? nameTakenMessage(shown, 'hidden_account') : null
}

/** A login already taken by any account on the list, hidden ones included. */
export function loginClash(rows: StaffRow[], username: string): string | null {
  const wanted = username.trim().toLowerCase()
  return rows.some((r) => r.kind === 'account' && r.account.username === wanted)
    ? 'Tên đăng nhập này đã có người dùng'
    : null
}

/** The hidden account an employee of this name re-opens when made GS/Visitor (A1). */
export function parkedAccountFor(rows: StaffRow[], name: string): GsUser | null {
  const key = personNameKey(name)
  const row = rows.find((r) => r.kind === 'account' && r.account.hidden && personNameKey(r.fullName) === key)
  return row?.kind === 'account' ? row.account : null
}
