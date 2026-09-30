import { describe, expect, it } from 'vitest'
import { duplicateNameMessage, personNameKey } from './personName'

describe('personNameKey', () => {
  it('folds case and outer spaces as lower(btrim()) does (0032, 0037)', () => {
    expect(personNameKey('  Nguyễn Văn A ')).toBe('nguyễn văn a')
    expect(personNameKey('NGUYỄN VĂN A')).toBe(personNameKey('nguyễn văn a'))
  })

  it('keeps inner spaces and tones: those are different names to the database', () => {
    expect(personNameKey('Nguyễn  Văn A')).not.toBe(personNameKey('Nguyễn Văn A'))
    expect(personNameKey('Nguyen Van A')).not.toBe(personNameKey('Nguyễn Văn A'))
  })
})

describe('duplicateNameMessage', () => {
  it('names an existing employee for the roster index (23505)', () => {
    expect(duplicateNameMessage({ code: '23505', message: 'duplicate key value violates unique constraint "employees_name_key"' }, 'Lê Văn A'))
      .toBe('Đã có nhân viên tên "Lê Văn A".')
  })

  it('names an existing account for the 0037 check with detail account', () => {
    expect(duplicateNameMessage({ code: 'PPDUP', message: 'duplicate_person_name: x', details: 'account' }, 'Lê Văn A'))
      .toBe('Đã có tài khoản GS/Visitor tên "Lê Văn A".')
  })

  it('names an existing employee for the 0037 check with detail employee', () => {
    expect(duplicateNameMessage({ code: 'PPDUP', message: 'duplicate_person_name: x', details: 'employee' }, 'Lê Văn A'))
      .toBe('Đã có nhân viên tên "Lê Văn A".')
  })

  it('says when the account or employee holding the name is out of the default view', () => {
    expect(duplicateNameMessage({ code: 'PPDUP', details: 'hidden_account' }, 'A'))
      .toBe('Đã có tài khoản GS/Visitor tên "A" (đã ẩn; chọn Trạng thái «Đã ẩn» để thấy).')
    expect(duplicateNameMessage({ code: 'PPDUP', details: 'retired_employee' }, 'A'))
      .toBe('Đã có nhân viên tên "A" (đã nghỉ; chọn Trạng thái «Đã nghỉ» để thấy).')
  })

  it('leaves every other error alone', () => {
    expect(duplicateNameMessage({ code: '42501', message: 'permission denied' }, 'Lê Văn A')).toBeNull()
    expect(duplicateNameMessage({ message: 'mất kết nối' }, 'Lê Văn A')).toBeNull()
  })
})
