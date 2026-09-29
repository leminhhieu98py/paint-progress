import { describe, expect, it } from 'vitest'
import { carryFilters, clearCarried, peekCarried } from './fieldCarry'

describe('fieldCarry (I-1)', () => {
  it('hands a page\'s filters to the same page of the chosen project, until cleared', () => {
    carryFilters('kpi', 'p1', { deckId: 'd1' })
    expect(peekCarried('kpi', 'p1')).toEqual({ deckId: 'd1' })
    // Read twice (a render may run twice), still there.
    expect(peekCarried('kpi', 'p1')).toEqual({ deckId: 'd1' })
    expect(peekCarried('dashboard', 'p1')).toBeUndefined()
    expect(peekCarried('kpi', 'p2')).toBeUndefined()
    clearCarried('kpi', 'p1')
    expect(peekCarried('kpi', 'p1')).toBeUndefined()
  })

  it('keeps a value as it was, dates included, where history state would clone it', () => {
    const range = [new Date(2026, 8, 1), null]
    carryFilters('dashboard', 'p1', { range })
    expect(peekCarried<{ range: unknown[] }>('dashboard', 'p1')?.range[0]).toBe(range[0])
    clearCarried('dashboard', 'p1')
  })

  it('has nothing for a page with no project', () => {
    expect(peekCarried('kpi', null)).toBeUndefined()
  })
})
