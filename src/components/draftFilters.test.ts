import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDraftFilters, useProjectOptions } from './draftFilters'

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
  it('loads the options of the project it is given, once per project', async () => {
    const load = vi.fn(async (id: string) => [`${id}-a`])
    const { result, rerender } = renderHook(({ id }) => useProjectOptions(id, load), { initialProps: { id: 'p1' as string | null } })
    await waitFor(() => expect(result.current).toEqual(['p1-a']))
    rerender({ id: 'p2' })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toEqual(['p2-a']))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('loads nothing without a project', () => {
    const load = vi.fn(async () => [])
    const { result } = renderHook(() => useProjectOptions(null, load))
    expect(result.current).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
