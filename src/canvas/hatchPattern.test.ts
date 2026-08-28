import { describe, expect, it, vi } from 'vitest'
import { createHatchPattern } from './hatchPattern'

describe('createHatchPattern', () => {
  it('returns null where there is no 2D context, rather than throwing', () => {
    // This is the normal answer under jsdom, which implements no canvas. The
    // drawing then renders its bays unhatched -- worse to look at, but the
    // screen still comes up, which is the point.
    expect(createHatchPattern()).toBeNull()
  })

  it('returns null rather than a blank tile when getContext fails', () => {
    // Reachable in a real browser too: a tab under memory pressure can refuse
    // a new 2D context. A blank tile would paint every pending bay solid
    // white and hide the colour underneath it.
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(null)
    vi.spyOn(document, 'createElement').mockReturnValueOnce(canvas)

    expect(createHatchPattern()).toBeNull()
    vi.restoreAllMocks()
  })
})
