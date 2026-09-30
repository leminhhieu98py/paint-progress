import { describe, expect, it } from 'vitest'
import { initialsOf } from './initials'

describe('initialsOf (field account trigger)', () => {
  it.each([
    // The shared rule (AD2): the last two words' first letters, letters only.
    ['Nguyễn Văn A', 'gs1', 'VA'],
    ['đặng thị hoa', 'x', 'TH'],
    ['Phạm Đức Long (demo)', 'x', 'ĐL'],
    ['Linh', 'linhhh', 'L'],
    ['Lê Văn', 'x', 'LV'],
    ['Âu Thành', 'x', 'ÂT'],
    // No name: the login's first letter, else a question mark.
    ['   ', 'sep.test', 'S'],
    ['(demo)', 'sep.test', 'S'],
    ['', '', '?'],
  ])('%j (%s) reads %s', (fullName, username, expected) => {
    expect(initialsOf(fullName, username)).toBe(expected)
  })
})
