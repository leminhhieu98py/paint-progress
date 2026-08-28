import { describe, expect, it } from 'vitest'
import { initialsOf } from './initials'

describe('initialsOf', () => {
  it('takes the first and last name, which is how a Vietnamese name is read', () => {
    // "Nguyễn Thị Linh" is surname · middle · given. The two that identify a
    // person in conversation are the surname and the given name, so the middle
    // one is what drops -- taking the last two would give TL and read as a
    // different person.
    expect(initialsOf('Nguyễn Thị Linh')).toBe('NL')
    expect(initialsOf('Lê Trung Hiếu')).toBe('LH')
  })

  it('uses both letters of a two-part name', () => {
    expect(initialsOf('Trần Long')).toBe('TL')
  })

  it('doubles a single-word name rather than returning one lonely letter', () => {
    expect(initialsOf('Linh')).toBe('LI')
  })

  it('survives the empty and whitespace cases without throwing', () => {
    // Reachable: profiles.full_name is nullable in the schema, and the avatar
    // renders before the profile row has loaded.
    expect(initialsOf('')).toBe('')
    expect(initialsOf('   ')).toBe('')
  })

  it('collapses runs of whitespace instead of reading them as names', () => {
    expect(initialsOf('  Nguyễn   Thị  Linh ')).toBe('NL')
  })

  it('upper-cases, so a lower-case profile name still reads as an avatar', () => {
    expect(initialsOf('nguyễn linh')).toBe('NL')
  })
})
