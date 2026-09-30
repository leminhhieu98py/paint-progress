import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lastDeckKey, openingDeckId, rememberDeck } from './lastDeck'

const DECKS = [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('last deck per project (GS-02)', () => {
  it('keys the memory by project', () => {
    expect(lastDeckKey('p1')).toBe('pp:lastDeck:p1')
  })

  it('opens the first deck when nothing is remembered', () => {
    expect(openingDeckId('p1', DECKS)).toBe('d1')
  })

  it('opens the deck last chosen in this project', () => {
    rememberDeck('p1', 'd2')
    expect(sessionStorage.getItem('pp:lastDeck:p1')).toBe('d2')
    expect(openingDeckId('p1', DECKS)).toBe('d2')
  })

  it('keeps each project\'s own deck', () => {
    rememberDeck('p1', 'd2')
    rememberDeck('p2', 'd3')
    expect(openingDeckId('p1', DECKS)).toBe('d2')
    expect(openingDeckId('p2', DECKS)).toBe('d3')
  })

  it('falls back to the first deck when the remembered one is no longer offered', () => {
    rememberDeck('p1', 'gone')
    expect(openingDeckId('p1', DECKS)).toBe('d1')
  })

  it('opens nothing for a project with no deck', () => {
    rememberDeck('p1', 'd2')
    expect(openingDeckId('p1', [])).toBeNull()
  })

  it('falls back to the first deck when storage cannot be read', () => {
    rememberDeck('p1', 'd2')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(openingDeckId('p1', DECKS)).toBe('d1')
  })

  it('carries on when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => rememberDeck('p1', 'd2')).not.toThrow()
  })
})
