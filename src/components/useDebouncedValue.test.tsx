import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue (FLT-08: a search box alone applies on change, debounced)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts on the value it is given', () => {
    const { result } = renderHook(() => useDebouncedValue('Tổ 1'))
    expect(result.current).toBe('Tổ 1')
  })

  it('follows a change only once the typing has paused', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), { initialProps: { v: '' } })
    rerender({ v: 't' })
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1))
    rerender({ v: 'to' })
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1))
    // Every keystroke starts the wait again.
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('to')
  })
})
