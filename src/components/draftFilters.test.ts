import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { settleDraft, useDraftFilters, useProjectOptions } from './draftFilters'

const DEFAULTS = { deck: '', coat: '' }

describe('useDraftFilters (FLT-02)', () => {
  it('applies the defaults on first load, without a click', () => {
    const { result } = renderHook(() => useDraftFilters(DEFAULTS))
    expect(result.current.applied).toEqual(DEFAULTS)
    expect(result.current.draft).toEqual(DEFAULTS)
  })

  it('changes only the draft until apply', () => {
    const { result } = renderHook(() => useDraftFilters(DEFAULTS))
    act(() => result.current.setDraft({ deck: 'd1' }))
    act(() => result.current.setDraft((d) => ({ ...d, coat: 'c1' })))
    expect(result.current.draft).toEqual({ deck: 'd1', coat: 'c1' })
    expect(result.current.applied).toEqual(DEFAULTS)
    act(() => result.current.apply())
    expect(result.current.applied).toEqual({ deck: 'd1', coat: 'c1' })
  })

  it('applies a value the caller has settled, when it passes one', () => {
    const { result } = renderHook(() => useDraftFilters(DEFAULTS))
    act(() => result.current.setDraft({ deck: 'gone' }))
    act(() => result.current.apply({ deck: '', coat: '' }))
    expect(result.current.applied).toEqual(DEFAULTS)
    expect(result.current.draft).toEqual(DEFAULTS)
  })

  it('resets draft and applied to the defaults at once', () => {
    const { result } = renderHook(() => useDraftFilters(DEFAULTS))
    act(() => result.current.setDraft({ deck: 'd1' }))
    act(() => result.current.apply())
    act(() => result.current.setDraft({ coat: 'c9' }))
    act(() => result.current.reset())
    expect(result.current.draft).toEqual(DEFAULTS)
    expect(result.current.applied).toEqual(DEFAULTS)
  })

  it('counts every apply and reset, so a pager can go back to page 1 on each', () => {
    const { result } = renderHook(() => useDraftFilters(DEFAULTS))
    const first = result.current.version
    act(() => result.current.apply())
    expect(result.current.version).toBe(first + 1)
    act(() => result.current.reset())
    expect(result.current.version).toBe(first + 2)
  })
})

describe('useProjectOptions (FLT-02)', () => {
  it('loads the options of the project it is given, once per project, and says when it is loading', async () => {
    const load = vi.fn(async (id: string) => [`${id}-a`])
    const { result, rerender } = renderHook(({ id }) => useProjectOptions(id, load), { initialProps: { id: 'p1' as string | null } })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.options).toEqual(['p1-a']))
    expect(result.current.loading).toBe(false)
    rerender({ id: 'p2' })
    expect(result.current.options).toBeNull()
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.options).toEqual(['p2-a']))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps what it read, by project, after it is asked for another', async () => {
    const load = vi.fn(async (id: string) => [`${id}-a`])
    const { result, rerender } = renderHook(({ id }) => useProjectOptions(id, load), { initialProps: { id: 'p1' as string | null } })
    await waitFor(() => expect(result.current.options).toEqual(['p1-a']))
    rerender({ id: null })
    expect(result.current.cached('p1')).toEqual(['p1-a'])
    expect(result.current.cached('p2')).toBeNull()
    rerender({ id: 'p1' })
    expect(result.current.options).toEqual(['p1-a'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('ignores a response that arrives after the project changed', async () => {
    let resolveFirst: (v: string[]) => void = () => {}
    const load = vi.fn((id: string) =>
      id === 'p1' ? new Promise<string[]>((r) => { resolveFirst = r }) : Promise.resolve([`${id}-a`]))
    const { result, rerender } = renderHook(({ id }) => useProjectOptions(id, load), { initialProps: { id: 'p1' as string | null } })
    rerender({ id: 'p2' })
    await waitFor(() => expect(result.current.options).toEqual(['p2-a']))
    await act(async () => resolveFirst(['late-p1']))
    expect(result.current.options).toEqual(['p2-a'])
    expect(result.current.loading).toBe(false)
  })

  it('stops loading, with no options, when the read fails', async () => {
    const load = vi.fn(async () => { throw new Error('mạng hỏng') })
    const { result } = renderHook(() => useProjectOptions('p1', load))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.options).toBeNull()
  })

  it('loads nothing without a project', () => {
    const load = vi.fn(async () => [])
    const { result } = renderHook(() => useProjectOptions(null, load))
    expect(result.current.options).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })
})

describe('settleDraft (FLT-02)', () => {
  const settle = (d: { deck: string; coat: string }, decks: string[]) => ({ ...d, deck: decks.includes(d.deck) ? d.deck : '' })

  it('leaves the draft alone while the options are unknown', () => {
    const { result } = renderHook(() => {
      const scope = useDraftFilters({ deck: 'Sàn A', coat: '' })
      return { scope, shown: settleDraft(scope, null, settle) }
    })
    expect(result.current.shown.deck).toBe('Sàn A')
    expect(result.current.scope.draft.deck).toBe('Sàn A')
  })

  it('clears, in the draft itself, a choice the options no longer have', () => {
    const { result, rerender } = renderHook(({ decks }) => {
      const scope = useDraftFilters({ deck: 'Sàn A', coat: '' })
      return { scope, shown: settleDraft(scope, decks, settle) }
    }, { initialProps: { decks: ['Sàn A'] as string[] } })
    expect(result.current.scope.draft.deck).toBe('Sàn A')
    rerender({ decks: ['Sàn Z'] })
    expect(result.current.shown.deck).toBe('')
    expect(result.current.scope.draft.deck).toBe('')
    rerender({ decks: ['Sàn A'] })
    expect(result.current.scope.draft.deck).toBe('')
  })
})
