import { describe, expect, it, vi } from 'vitest'
import { MIN_PASSWORD_LENGTH, generatePassword } from './passwordGen'

describe('generatePassword', () => {
  it('always clears the length floor, even on the shortest possible draw', () => {
    // Not a sample: forced to the worst case. Every index resolves to WORDS[0],
    // the shortest word in the list, and the digits to "00" -- the shortest
    // string this function can produce. If that clears the floor, nothing does
    // not.
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      ;(array as Uint32Array).fill(0)
      return array
    })
    try {
      expect(generatePassword().length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('clears the floor across many real draws', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generatePassword().length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH)
    }
  })

  it('does not repeat itself', () => {
    // A generator that returned one value would pass every length assertion
    // above and be worthless.
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()))
    expect(seen.size).toBeGreaterThan(45)
  })

  it('draws from the CSPRNG, not Math.random', () => {
    // This is a credential. Math.random is seeded predictably enough that two
    // accounts created in one session could be related to each other.
    const spy = vi.spyOn(crypto, 'getRandomValues')
    const random = vi.spyOn(Math, 'random')
    try {
      generatePassword()
      expect(spy).toHaveBeenCalled()
      expect(random).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('stays readable over a radio: lowercase letters, digits and hyphens only', () => {
    // It is spelled out to a foreman on a platform. Anything needing "capital"
    // or a symbol name gets written down wrong.
    for (let i = 0; i < 50; i += 1) {
      expect(generatePassword()).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('ends in digits, so it satisfies a digit requirement wherever one is set', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generatePassword()).toMatch(/-\d{2}$/)
    }
  })
})
