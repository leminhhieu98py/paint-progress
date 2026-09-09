import { describe, expect, it } from 'vitest'
import { foldForSearch, matchesSearch } from './search'

describe('foldForSearch', () => {
  it('drops case and every tone mark', () => {
    expect(foldForSearch('Cao Minh Hải')).toBe('cao minh hai')
    expect(foldForSearch('TỔ 2')).toBe('to 2')
  })

  it('folds đ, which has no combining form and would otherwise never match', () => {
    expect(foldForSearch('Đoàn Công Linh')).toBe('doan cong linh')
  })

  it('leaves a name with no marks alone', () => {
    expect(foldForSearch('MC005593 - GG')).toBe('mc005593 - gg')
  })
})

describe('matchesSearch', () => {
  it('matches any part of the string, not just its start', () => {
    expect(matchesSearch('MC005593 - Cao Minh Hải', 'hai')).toBe(true)
    expect(matchesSearch('MC005593 - Cao Minh Hải', 'minh')).toBe(true)
    expect(matchesSearch('MC005593 - Cao Minh Hải', '005593')).toBe(true)
  })

  it('matches a typed name against a stored one whichever carries the tones', () => {
    expect(matchesSearch('Cao Minh Hải', 'HẢI')).toBe(true)
    expect(matchesSearch('Cao Minh Hai', 'hải')).toBe(true)
  })

  it('says no to a name that is not there', () => {
    expect(matchesSearch('Cao Minh Hải', 'nam')).toBe(false)
  })

  it('matches everything on a blank or whitespace needle, so clearing the box restores the list', () => {
    expect(matchesSearch('Cao Minh Hải', '')).toBe(true)
    expect(matchesSearch('Cao Minh Hải', '   ')).toBe(true)
  })
})
