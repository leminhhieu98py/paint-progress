import { describe, expect, it } from 'vitest'
import { initialsOf } from './initials'

describe('initialsOf', () => {
  it.each([
    ['Nguyễn Văn A', 'gs1', 'NA'],
    ['đặng thị hoa', 'x', 'ĐH'],
    ['Linh', 'linhhh', 'L'],
    ['   ', 'sep.test', 'S'],
    ['', '', '?'],
    ['Le\u0302 Va\u0306n', 'x', 'LV'],
    ['A\u0302u Tha\u0300nh', 'x', 'ÂT'],
  ])('%j (%s) reads %s', (fullName, username, expected) => {
    expect(initialsOf(fullName, username)).toBe(expected)
  })
})
