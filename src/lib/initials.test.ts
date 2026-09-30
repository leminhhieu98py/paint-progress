import { describe, expect, it } from 'vitest'
import { initialsOf, nameWords } from './initials'

describe('initialsOf (AD2, owner-amended)', () => {
  it('takes the first letter of each of the last two words', () => {
    expect(initialsOf('Nguyễn Thị Linh')).toBe('TL')
    expect(initialsOf('Lê Trung Hiếu')).toBe('TH')
    expect(initialsOf('Linh Linh')).toBe('LL')
    expect(initialsOf('Trần Long')).toBe('TL')
  })

  it('reads one letter for a one-word name', () => {
    expect(initialsOf('Linh')).toBe('L')
  })

  it('drops a bracketed note and any word with no letter before it counts', () => {
    expect(initialsOf('Phạm Đức Long (demo)')).toBe('ĐL')
    expect(initialsOf('Bùi Quang Huy (demo)')).toBe('QH')
    expect(initialsOf('Châu Văn Đạt [test]')).toBe('VĐ')
    expect(initialsOf('Lê Văn A 2')).toBe('VA')
    expect(initialsOf('(demo)')).toBe('')
  })

  it('keeps Vietnamese letters when it upper-cases', () => {
    expect(initialsOf('đặng thị hoa')).toBe('TH')
    expect(initialsOf('phạm đức long')).toBe('ĐL')
  })

  it('survives the empty and whitespace cases without throwing', () => {
    // Reachable: profiles.full_name is nullable in the schema, and the avatar
    // renders before the profile row has loaded.
    expect(initialsOf('')).toBe('')
    expect(initialsOf('   ')).toBe('')
  })

  it('collapses runs of whitespace instead of reading them as names', () => {
    expect(initialsOf('  Nguyễn   Thị  Linh ')).toBe('TL')
  })
})

describe('nameWords', () => {
  it('keeps each word to its letters and drops bracketed notes', () => {
    expect(nameWords('Đỗ Minh, Tổ 2 (demo)')).toEqual(['Đỗ', 'Minh', 'Tổ'])
  })
})
