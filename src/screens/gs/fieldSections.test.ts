import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFieldNarrowPhone } from './fieldSections'

const original = window.matchMedia
afterEach(() => {
  window.matchMedia = original
})

/** A matchMedia whose one list can be flipped, with the listener API given. */
function fakeMedia(api: 'modern' | 'legacy', matches = false) {
  const listeners = new Set<() => void>()
  const list = {
    matches,
    media: '',
    addEventListener: api === 'modern' ? vi.fn((_: string, l: () => void) => listeners.add(l)) : undefined,
    removeEventListener: api === 'modern' ? vi.fn((_: string, l: () => void) => listeners.delete(l)) : undefined,
    addListener: vi.fn((l: () => void) => listeners.add(l)),
    removeListener: vi.fn((l: () => void) => listeners.delete(l)),
  }
  window.matchMedia = (() => list) as unknown as typeof window.matchMedia
  const flip = (next: boolean) => {
    list.matches = next
    for (const l of listeners) l()
  }
  return { list, flip }
}

describe('useFieldNarrowPhone (MOB-02, RR-M4)', () => {
  it('asks for a screen under 360 px', () => {
    const queries: string[] = []
    window.matchMedia = ((q: string) => {
      queries.push(q)
      return { matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }
    }) as unknown as typeof window.matchMedia
    renderHook(() => useFieldNarrowPhone())
    expect(new Set(queries)).toEqual(new Set(['(max-width: 359.98px)']))
  })

  it('subscribes once, not on every render', () => {
    const { list } = fakeMedia('modern')
    const { rerender } = renderHook(() => useFieldNarrowPhone())
    rerender()
    rerender()
    expect(list.addEventListener).toHaveBeenCalledTimes(1)
    expect(list.removeEventListener).not.toHaveBeenCalled()
  })

  it('follows the query as it changes', () => {
    const { flip } = fakeMedia('modern', false)
    const { result } = renderHook(() => useFieldNarrowPhone())
    expect(result.current).toBe(false)
    act(() => flip(true))
    expect(result.current).toBe(true)
  })

  it('falls back to addListener where a browser has no addEventListener on a media list', () => {
    const { list, flip } = fakeMedia('legacy', false)
    const { result, unmount } = renderHook(() => useFieldNarrowPhone())
    expect(list.addListener).toHaveBeenCalledTimes(1)
    act(() => flip(true))
    expect(result.current).toBe(true)
    unmount()
    expect(list.removeListener).toHaveBeenCalledTimes(1)
  })
})
