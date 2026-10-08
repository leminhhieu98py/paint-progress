import { describe, expect, it } from 'vitest'
import { capList, MAX_LISTED } from './listCap'

describe('capList', () => {
  it('keeps a list of up to 200 whole', () => {
    const items = Array.from({ length: MAX_LISTED }, (_, i) => i)
    expect(capList(items)).toEqual({ shown: items, more: 0 })
  })

  it('keeps the first 200 and counts the rest', () => {
    const { shown, more } = capList(Array.from({ length: 205 }, (_, i) => i))
    expect(shown).toHaveLength(200)
    expect(shown.at(-1)).toBe(199)
    expect(more).toBe(5)
  })
})
