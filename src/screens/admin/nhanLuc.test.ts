import { describe, expect, it } from 'vitest'
import type { GsUser } from '../../lib/adminApi'
import type { Employee } from '../../lib/employeesApi'
import {
  DEFAULT_FILTERS, ROLE_DESCRIPTION, ROLE_LABEL, buildRows, countFacts, filterRows, isFiltered,
  loginClash, nameClash, parkedAccountFor,
} from './nhanLuc'

const account = (over: Partial<GsUser>): GsUser => ({
  id: 'u1', username: 'gs1', fullName: 'GS Một', active: true, role: 'gs', hidden: false, projects: [], ...over,
})
const employee = (over: Partial<Employee>): Employee => ({ id: 'e1', fullName: 'Lê Văn A', active: true, ...over })

const ACCOUNTS = [
  account({ id: 'u1', username: 'gs.bich', fullName: 'Bích Trần' }),
  account({ id: 'u2', username: 'sep.an', fullName: 'Ân Lê', role: 'viewer', active: false }),
  account({ id: 'u3', username: 'lan.cu', fullName: 'Trần Thị Lan', role: 'viewer', active: false, hidden: true }),
]
const EMPLOYEES = [
  employee({ id: 'e1', fullName: 'Đoàn Công Linh' }),
  employee({ id: 'e2', fullName: 'An Nguyễn', active: false }),
  employee({ id: 'e3', fullName: 'trần thị lan' }),
]

describe('buildRows (NL-01)', () => {
  it('lists accounts and employees as one list, keyed by kind and id, sorted by name in Vietnamese order', () => {
    const rows = buildRows(ACCOUNTS, EMPLOYEES)
    expect(rows.map((r) => r.key)).toEqual(['employee:e2', 'account:u2', 'account:u1', 'employee:e1', 'employee:e3', 'account:u3'])
    expect(rows.map((r) => r.fullName)).toEqual(['An Nguyễn', 'Ân Lê', 'Bích Trần', 'Đoàn Công Linh', 'trần thị lan', 'Trần Thị Lan'])
  })

  it('gives each row its Phân quyền and its Trạng thái', () => {
    const byKey = Object.fromEntries(buildRows(ACCOUNTS, EMPLOYEES).map((r) => [r.key, [r.role, r.status]]))
    expect(byKey).toEqual({
      'account:u1': ['gs', 'Đang dùng'],
      'account:u2': ['viewer', 'Đã khoá'],
      'account:u3': ['viewer', 'Đã ẩn'],
      'employee:e1': ['employee', 'Đang làm'],
      'employee:e2': ['employee', 'Đã nghỉ'],
      'employee:e3': ['employee', 'Đang làm'],
    })
  })
})

describe('filterRows (NL-01, FLT-02)', () => {
  const rows = buildRows(ACCOUNTS, EMPLOYEES)
  const keys = (f: Partial<typeof DEFAULT_FILTERS>) => filterRows(rows, { ...DEFAULT_FILTERS, ...f }).map((r) => r.key)

  it('leaves hidden accounts and retired employees out by default', () => {
    expect(keys({})).toEqual(['account:u2', 'account:u1', 'employee:e1', 'employee:e3'])
  })

  it('shows every row on Tất cả trạng thái, and one status on its own', () => {
    expect(keys({ status: 'all' })).toHaveLength(6)
    expect(keys({ status: 'Đã ẩn' })).toEqual(['account:u3'])
    expect(keys({ status: 'Đã nghỉ' })).toEqual(['employee:e2'])
    expect(keys({ status: 'Đã khoá' })).toEqual(['account:u2'])
  })

  it('narrows by Phân quyền', () => {
    expect(keys({ role: 'employee' })).toEqual(['employee:e1', 'employee:e3'])
    expect(keys({ role: 'viewer', status: 'all' })).toEqual(['account:u2', 'account:u3'])
  })

  it('searches the name and the login, ignoring case and tones', () => {
    expect(keys({ query: 'doan cong' })).toEqual(['employee:e1'])
    expect(keys({ query: 'SEP.' })).toEqual(['account:u2'])
    expect(keys({ query: '  ' })).toHaveLength(4)
  })

  it('knows when the applied filters are the defaults', () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false)
    expect(isFiltered({ ...DEFAULT_FILTERS, query: ' ' })).toBe(false)
    expect(isFiltered({ ...DEFAULT_FILTERS, role: 'gs' })).toBe(true)
  })
})

describe('countFacts (HLT-01)', () => {
  const rows = buildRows(ACCOUNTS, EMPLOYEES)

  it('counts the accounts and employees on screen', () => {
    expect(countFacts(rows, filterRows(rows, DEFAULT_FILTERS), false)).toEqual([
      { value: 2, label: 'tài khoản' },
      { value: 2, label: 'nhân viên' },
    ])
  })

  it('says how many of the whole list a filter kept', () => {
    expect(countFacts(rows, filterRows(rows, { ...DEFAULT_FILTERS, role: 'gs' }), true))
      .toEqual([{ value: '1/6', label: 'dòng khớp bộ lọc' }])
  })
})

describe('one person, one row (NL-02, 0037)', () => {
  const rows = buildRows(ACCOUNTS, EMPLOYEES)

  it('refuses a new employee named like an employee or a visible account', () => {
    expect(nameClash(rows, ' ĐOÀN CÔNG LINH ', 'employee')).toBe('Đã có nhân viên tên "ĐOÀN CÔNG LINH".')
    expect(nameClash(rows, 'bích trần', 'employee')).toBe('Đã có tài khoản GS/Visitor tên "bích trần".')
    expect(nameClash(rows, 'Nguyễn Mới', 'employee')).toBeNull()
  })

  it('lets an employee share the name of a hidden account, as the database does (A1)', () => {
    expect(nameClash(rows.filter((r) => r.key !== 'employee:e3'), 'Trần Thị Lan', 'employee')).toBeNull()
  })

  it('refuses a new account named like any account, hidden included, or an employee', () => {
    expect(nameClash(rows, 'Trần thị Lan', 'account')).toBe('Đã có nhân viên tên "Trần thị Lan".')
    expect(nameClash(rows.filter((r) => r.kind === 'account'), 'Trần thị Lan', 'account'))
      .toBe('Đã có tài khoản GS/Visitor tên "Trần thị Lan" (đã ẩn; chọn Trạng thái «Đã ẩn» để thấy).')
    expect(nameClash(rows, 'An Nguyễn', 'account'))
      .toBe('Đã có nhân viên tên "An Nguyễn" (đã nghỉ; chọn Trạng thái «Đã nghỉ» để thấy).')
  })

  it('does not count the row being renamed against itself', () => {
    expect(nameClash(rows, 'Đoàn Công Linh', 'employee', 'employee:e1')).toBeNull()
  })

  it('refuses a login already taken, hidden accounts included', () => {
    expect(loginClash(rows, ' LAN.CU ')).toBe('Tên đăng nhập này đã có người dùng')
    expect(loginClash(rows, 'moi.tinh')).toBeNull()
  })

  it('finds the hidden account an employee would re-open', () => {
    expect(parkedAccountFor(rows, ' TRẦN THỊ LAN')?.id).toBe('u3')
    expect(parkedAccountFor(rows, 'Bích Trần')).toBeNull()
  })
})

describe('role texts', () => {
  it('labels the three roles as the badge does', () => {
    expect(ROLE_LABEL).toEqual({ employee: 'Nhân viên', gs: 'GS', viewer: 'Visitor' })
  })

  it('describes each role in one sentence, the same wherever it is shown', () => {
    for (const text of Object.values(ROLE_DESCRIPTION)) {
      expect(text).toMatch(/^[^.]+\.$/)
    }
  })
})
