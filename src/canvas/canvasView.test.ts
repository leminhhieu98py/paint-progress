import { describe, expect, it } from 'vitest'
import { clampStagePan, clampZoom, cropFromDrag, MAX_ZOOM, MIN_ZOOM } from './canvasView'


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
