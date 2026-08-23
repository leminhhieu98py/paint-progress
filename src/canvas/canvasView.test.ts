import { describe, expect, it } from 'vitest'
import { guideHitProfile } from './canvasView'

/**
 * Reads a profile at an arbitrary point along the guide, the way the canvas
 * rasterises the polygon between two vertices: linearly. This is how the tests
 * ask "how wide is the grab band HERE", which is the question the profile
 * exists to answer.
 */
function halfWidthAt(profile: [number, number][], along: number): number {
  for (let i = 1; i < profile.length; i += 1) {
    const [a0, h0] = profile[i - 1]
    const [a1, h1] = profile[i]
    if (along >= a0 && along <= a1) {
      return a1 === a0 ? Math.max(h0, h1) : h0 + ((h1 - h0) * (along - a0)) / (a1 - a0)
    }
  }
  return 0
}

describe('guideHitProfile', () => {
  it('is full width along a guide nothing crosses', () => {
    // 14 px wide overall, i.e. 7 either side: a fingertip target, against the
    // 2 px the browser session found unusable.
    expect(guideHitProfile(720, [], 7)).toEqual([[0, 7], [720, 7]])
  })

  it('tapers to nothing exactly at a crossing', () => {
    expect(guideHitProfile(720, [360], 7))
      .toEqual([[0, 7], [353, 7], [360, 0], [367, 7], [720, 7]])
  })

  it('gives a contested pointer to the guide whose line is nearer', () => {
    // The rule that replaces the z-order lottery. Scene: a 900 x 720 stage, a
    // vertical guide at x = 500, a horizontal guide at y = 360, and a pointer at
    // (503, 370) -- 3 px off the vertical's line, 10 px off the horizontal's.
    const pointer = { x: 503, y: 370 }
    const vertical = guideHitProfile(720, [360], 7)     // along the y axis
    const horizontal = guideHitProfile(900, [500], 7)   // along the x axis

    // 10 px along the vertical from the crossing, its band is still full width,
    // so a pointer 3 px off its line is inside it.
    expect(halfWidthAt(vertical, pointer.y)).toBe(7)
    expect(Math.abs(pointer.x - 500)).toBeLessThanOrEqual(halfWidthAt(vertical, pointer.y))

    // The same pointer sits only 3 px along the horizontal from that crossing,
    // where its band has tapered to 3 px -- so 10 px off its line is outside.
    expect(halfWidthAt(horizontal, pointer.x)).toBe(3)
    expect(Math.abs(pointer.y - 360)).toBeGreaterThan(halfWidthAt(horizontal, pointer.x))

    // The literal half-widths are asserted as well as the two comparisons: a
    // profile that collapsed to zero everywhere would satisfy the "outside"
    // half on its own and look like a pass.
  })

  it('sorts crossings before walking them', () => {
    // Catches an implementation that trusts the caller's order. Guides arrive in
    // offset_mm order from listGuides but in add-order from the editor's local
    // state, so both are real.
    expect(guideHitProfile(720, [500, 100], 7)).toEqual([
      [0, 7], [93, 7], [100, 0], [107, 7], [493, 7], [500, 0], [507, 7], [720, 7],
    ])
  })

  it('keeps a ridge between two crossings closer together than the band', () => {
    // Two guides 10 px apart with a 7 px half-width. The band pinches twice and
    // recovers to only 3 px between them, which is correct: a pointer there is
    // within 3 px of one crossing, so it is only the nearest guide's if it is
    // closer than that to the line.
    expect(guideHitProfile(720, [100, 110], 7)).toEqual([
      [0, 7], [93, 7], [100, 0], [103, 3], [107, 3], [110, 0], [117, 7], [720, 7],
    ])
  })

  it('tapers from the very start when a guide is crossed at its origin', () => {
    expect(guideHitProfile(720, [0], 7)).toEqual([[0, 0], [7, 7], [720, 7]])
  })

  it('tapers to the very end when a guide is crossed at its far edge', () => {
    expect(guideHitProfile(720, [720], 7)).toEqual([[0, 7], [713, 7], [720, 0]])
  })

  it('has no band at all on a zero-length guide', () => {
    // An image whose dimensions have not loaded yet. Returning a single vertex
    // would ask the canvas to fill a degenerate polygon.
    expect(guideHitProfile(0, [], 7)).toEqual([])
  })
})
