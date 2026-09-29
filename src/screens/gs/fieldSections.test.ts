import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFieldFullWidthControls } from './fieldSections'

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

describe('useFieldFullWidthControls (C2, RR-M4)', () => {
  it('subscribes once, not on every render', () => {
    const { list } = fakeMedia('modern')
    const { rerender } = renderHook(() => useFieldFullWidthControls())
    rerender()
    rerender()
    expect(list.addEventListener).toHaveBeenCalledTimes(1)
    expect(list.removeEventListener).not.toHaveBeenCalled()
  })

  it('follows the query as it changes', () => {
    const { flip } = fakeMedia('modern', false)
    const { result } = renderHook(() => useFieldFullWidthControls())
    expect(result.current).toBe(false)
    act(() => flip(true))
    expect(result.current).toBe(true)
  })

  it('falls back to addListener where a browser has no addEventListener on a media list', () => {
    const { list, flip } = fakeMedia('legacy', false)
    const { result, unmount } = renderHook(() => useFieldFullWidthControls())
    expect(list.addListener).toHaveBeenCalledTimes(1)
    act(() => flip(true))
    expect(result.current).toBe(true)
    unmount()
    expect(list.removeListener).toHaveBeenCalledTimes(1)
  })
})
