import { describe, expect, it } from 'vitest'
import { clampStagePan, clampZoom, cropFromDrag, guideHitProfile, MAX_ZOOM, MIN_ZOOM } from './canvasView'

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

describe('clampZoom', () => {
  it('keeps a value inside the range', () => {
    expect(clampZoom(2.5)).toBe(2.5)
  })

  it('refuses to zoom out past fit-to-container', () => {
    // MIN_ZOOM is 1 = the whole drawing exactly fills the container. Zooming out
    // further would letterbox the drawing inside its own canvas.
    expect(clampZoom(0.25)).toBe(MIN_ZOOM)
  })

  it('caps zoom in', () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM)
  })

  it('falls back to fit-to-container for NaN', () => {
    // A wheel event on some trackpads reports deltaY through emulated input;
    // NaN would propagate into every Konva scale and blank the canvas with no
    // error anywhere.
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM)
  })
})

describe('clampStagePan', () => {
  it('allows no panning at all at fit-to-container zoom', () => {
    // At zoom 1 there is nothing off-screen to pan to, so both bounds collapse
    // to 0. Catches a clamp derived from the stage size instead of the zoom.
    expect(clampStagePan({ x: -300, y: 120 }, 900, 720, 1)).toEqual({ x: 0, y: 0 })
  })

  it('stops the drawing being dragged past its right and bottom edges', () => {
    // At zoom 2 the content is 1800 x 1440 in a 900 x 720 viewport, so the
    // furthest left/up it may sit is -900 / -720.
    expect(clampStagePan({ x: -5000, y: -5000 }, 900, 720, 2)).toEqual({ x: -900, y: -720 })
  })

  it('stops the drawing being dragged past its left and top edges', () => {
    expect(clampStagePan({ x: 400, y: 300 }, 900, 720, 2)).toEqual({ x: 0, y: 0 })
  })

  it('leaves an in-range pan untouched', () => {
    expect(clampStagePan({ x: -300, y: -100 }, 900, 720, 2)).toEqual({ x: -300, y: -100 })
  })
})

describe('cropFromDrag', () => {
  it('turns a drag into a normalized rect', () => {
    expect(cropFromDrag({ x: 90, y: 40 }, { x: 450, y: 240 }, 900, 400)).toEqual({
      x: 0.1, y: 0.1, w: 0.4, h: 0.5,
    })
  })

  it('gives the same rect whichever corner the drag started from', () => {
    // The admin drags whichever way is comfortable; bottom-right to top-left
    // must not produce a negative width that meshes into nothing.
    const forward = cropFromDrag({ x: 90, y: 40 }, { x: 450, y: 240 }, 900, 400)
    const backward = cropFromDrag({ x: 450, y: 240 }, { x: 90, y: 40 }, 900, 400)
    expect(backward).toEqual(forward)
  })

  it('clamps a drag that runs off the canvas instead of losing it', () => {
    // Dragging past the edge is how you include the deck's outermost beam;
    // the pointer leaving the stage must not throw the whole gesture away.
    expect(cropFromDrag({ x: -200, y: -50 }, { x: 1400, y: 900 }, 900, 400)).toEqual({
      x: 0, y: 0, w: 1, h: 1,
    })
  })

  it('refuses a stray click and a drag too small to be a deck', () => {
    // A click with no movement, and a 4%-wide drag: both are misfires, and a
    // near-zero region would divide every span by almost nothing.
    expect(cropFromDrag({ x: 300, y: 200 }, { x: 300, y: 200 }, 900, 400)).toBeNull()
    expect(cropFromDrag({ x: 300, y: 40 }, { x: 336, y: 240 }, 900, 400)).toBeNull()
    expect(cropFromDrag({ x: 90, y: 200 }, { x: 450, y: 216 }, 900, 400)).toBeNull()
  })

  it('refuses a drag on an unmeasured canvas', () => {
    // DrawingCanvas renders once before its container is measured; a zero
    // width there would normalize every coordinate to Infinity.
    expect(cropFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, 0, 0)).toBeNull()
  })
})
