import { describe, expect, it } from 'vitest'
import {
  clampStagePan, clampZoom, boxFromDrag, fitLabelFontSize,
  MAX_LABEL_FONT_SIZE, MAX_ZOOM, MIN_LABEL_FONT_SIZE, MIN_ZOOM,
} from './canvasView'


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

describe('boxFromDrag', () => {
  it('turns a drag into a normalized rect', () => {
    expect(boxFromDrag({ x: 90, y: 40 }, { x: 450, y: 240 }, 900, 400, 0.05)).toEqual({
      x: 0.1, y: 0.1, w: 0.4, h: 0.5,
    })
  })

  it('gives the same rect whichever corner the drag started from', () => {
    // The admin drags whichever way is comfortable; bottom-right to top-left
    // must not produce a negative width that meshes into nothing.
    const forward = boxFromDrag({ x: 90, y: 40 }, { x: 450, y: 240 }, 900, 400, 0.05)
    const backward = boxFromDrag({ x: 450, y: 240 }, { x: 90, y: 40 }, 900, 400, 0.05)
    expect(backward).toEqual(forward)
  })

  it('clamps a drag that runs off the canvas instead of losing it', () => {
    // Dragging past the edge is how you include the deck's outermost beam;
    // the pointer leaving the stage must not throw the whole gesture away.
    expect(boxFromDrag({ x: -200, y: -50 }, { x: 1400, y: 900 }, 900, 400, 0.05)).toEqual({
      x: 0, y: 0, w: 1, h: 1,
    })
  })

  it('refuses a stray click and a drag too small to be a deck', () => {
    // A click with no movement, and a 4%-wide drag: both are misfires, and a
    // near-zero region would divide every span by almost nothing.
    expect(boxFromDrag({ x: 300, y: 200 }, { x: 300, y: 200 }, 900, 400, 0.05)).toBeNull()
    expect(boxFromDrag({ x: 300, y: 40 }, { x: 336, y: 240 }, 900, 400, 0.05)).toBeNull()
    expect(boxFromDrag({ x: 90, y: 200 }, { x: 450, y: 216 }, 900, 400, 0.05)).toBeNull()
  })

  it('refuses a drag on an unmeasured canvas', () => {
    // DrawingCanvas renders once before its container is measured; a zero
    // width there would normalize every coordinate to Infinity.
    expect(boxFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, 0, 0, 0.05)).toBeNull()
  })
})

describe('fitLabelFontSize', () => {
  it('gives a roomy bay the full size', () => {
    expect(fitLabelFontSize('01/08', 400, 200)).toBe(MAX_LABEL_FONT_SIZE)
  })

  it('shrinks the text to fit a narrow bay', () => {
    // "01/08 – 12/08" is 13 characters. At 0.55em each it needs ~7.15em, so a
    // 60px bay carries 8px -- readable, and well under the 12 a roomy bay gets.
    const size = fitLabelFontSize('01/08 – 12/08', 60, 200)!
    expect(size).toBeLessThan(MAX_LABEL_FONT_SIZE)
    expect(size).toBeGreaterThanOrEqual(MIN_LABEL_FONT_SIZE)
    // And it really fits: the estimate must not exceed the bay it was given.
    expect(size * '01/08 – 12/08'.length * 0.55).toBeLessThanOrEqual(60)
  })

  it('is limited by a short bay as well as a narrow one', () => {
    // A wide, flat bay: plenty of room across, none down. Height is what binds.
    expect(fitLabelFontSize('01/08', 4000, 10)).toBe(8)
  })

  it('returns null rather than a smudge when the bay is too small', () => {
    // The admin's screenshot: a date range at a fixed 12px spilling across three
    // neighbouring bays. Nothing is better than a label about the wrong bay --
    // the zone legend under the canvas still names it.
    expect(fitLabelFontSize('01/08 – 12/08', 30, 20)).toBeNull()
  })

  it('returns null for an empty label', () => {
    expect(fitLabelFontSize('', 400, 200)).toBeNull()
  })

  it('never returns a fractional size', () => {
    // Konva takes a number, but a font size of 9.37 renders differently across
    // browsers and makes two identical bays disagree by a pixel.
    const size = fitLabelFontSize('01/08 – 12/08', 137, 61)
    expect(size).toBe(Math.floor(size!))
  })
})
