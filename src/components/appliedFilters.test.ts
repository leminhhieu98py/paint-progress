import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { settleFilters, useAppliedFilters } from './appliedFilters'

const DEFAULTS = { deck: '', coat: '' }

describe('useAppliedFilters (RV7-3)', () => {
  it('applies what it opens on, without a click', () => {
    const { result } = renderHook(() => useAppliedFilters(DEFAULTS))
    expect(result.current.applied).toEqual(DEFAULTS)
  })

  it('can open on a value other than the defaults', () => {
    // A field page opened by a project switch starts on the filters it carried (I-1).
    const { result } = renderHook(() => useAppliedFilters({ deck: 'd1', coat: '' }))
    expect(result.current.applied).toEqual({ deck: 'd1', coat: '' })
  })

  it('applies each change at once, merged into what is applied', () => {
    const { result } = renderHook(() => useAppliedFilters(DEFAULTS))
    act(() => result.current.apply({ deck: 'd1' }))
    expect(result.current.applied).toEqual({ deck: 'd1', coat: '' })
    act(() => result.current.apply({ coat: 'c1' }))
    expect(result.current.applied).toEqual({ deck: 'd1', coat: 'c1' })
  })

  it('counts every apply, so a pager can go back to page 1 on each', () => {
    const { result } = renderHook(() => useAppliedFilters(DEFAULTS))
    const first = result.current.version
    act(() => result.current.apply({ deck: 'd1' }))
    expect(result.current.version).toBe(first + 1)
    act(() => result.current.apply({ deck: 'd1' }))
    expect(result.current.version).toBe(first + 2)
  })

  it('does not count a replace: it is a correction, not a change of the user\'s', () => {
    const { result } = renderHook(() => useAppliedFilters(DEFAULTS))
    act(() => result.current.replace({ deck: 'd2', coat: '' }))
    expect(result.current.applied).toEqual({ deck: 'd2', coat: '' })
    expect(result.current.version).toBe(0)
  })
})

describe('settleFilters', () => {
  const settle = (d: { deck: string; coat: string }, decks: string[]) => ({ ...d, deck: decks.includes(d.deck) ? d.deck : '' })

  it('leaves what is applied alone while the options are unknown', () => {
    const { result } = renderHook(() => {
      const scope = useAppliedFilters({ deck: 'Sàn A', coat: '' })
      return { scope, shown: settleFilters(scope, null, settle) }
    })
    expect(result.current.shown.deck).toBe('Sàn A')
    expect(result.current.scope.applied.deck).toBe('Sàn A')
  })

  it('clears, in what is applied, a choice the options no longer have, without counting it', () => {
    const { result, rerender } = renderHook(({ decks }) => {
      const scope = useAppliedFilters({ deck: 'Sàn A', coat: '' })
      return { scope, shown: settleFilters(scope, decks, settle) }
    }, { initialProps: { decks: ['Sàn A'] as string[] } })
    expect(result.current.scope.applied.deck).toBe('Sàn A')
    rerender({ decks: ['Sàn Z'] })
    expect(result.current.shown.deck).toBe('')
    expect(result.current.scope.applied.deck).toBe('')
    expect(result.current.scope.version).toBe(0)
    rerender({ decks: ['Sàn A'] })
    expect(result.current.scope.applied.deck).toBe('')
  })
})
