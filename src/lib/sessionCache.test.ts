import { describe, expect, it, vi } from 'vitest'
import { endSession, onSessionEnd } from './sessionCache'

describe('sessionCache', () => {
  it('runs every registered clear when the session ends', () => {
    const a = vi.fn()
    const b = vi.fn()
    onSessionEnd(a)
    onSessionEnd(b)
    endSession()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('keeps a clear registered for the next session too', () => {
    const a = vi.fn()
    onSessionEnd(a)
    endSession()
    endSession()
    expect(a).toHaveBeenCalledTimes(2)
  })
})
