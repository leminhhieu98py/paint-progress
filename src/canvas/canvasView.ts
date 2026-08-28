/**
 * The canvas's view maths, kept out of the component so it can be asserted with
 * literals. Nothing here touches Konva.
 */

/** 1 = the drawing exactly fills its container. Zooming out further would
 *  letterbox the drawing inside its own canvas, which is never useful. */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
/** Per button press. */
export const ZOOM_STEP = 0.5
/** Per wheel notch — finer than a button press, because a wheel emits many. */
export const WHEEL_ZOOM_STEP = 0.25

export function clampZoom(zoom: number): number {
  // NaN would propagate into Konva's scaleX/scaleY and blank the canvas with no
  // error anywhere; a wheel handler is one emulated input away from producing
  // one.
  if (Number.isNaN(zoom)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Keeps the panned drawing covering its viewport.
 *
 * At zoom z the content is width*z by height*z inside a width by height
 * viewport, so the stage's own position may run from width*(1-z) (content's
 * right edge flush with the viewport's) to 0 (left edges flush). At z = 1 both
 * bounds are 0: there is nothing off-screen, so there is nothing to pan.
 *
 * Without this a foreman can flick the drawing off the screen entirely and is
 * left with a blank canvas and no way back short of reloading.
 */
export function clampStagePan(
  pos: { x: number; y: number },
  width: number,
  height: number,
  zoom: number,
): { x: number; y: number } {
  return {
    x: Math.min(0, Math.max(width * (1 - zoom), pos.x)),
    y: Math.min(0, Math.max(height * (1 - zoom), pos.y)),
  }
}

/**
 * Smallest crop the admin can draw, as a fraction of the drawing on each axis.
 *
 * Below this the "deck" is almost certainly a misfire -- a click that moved a
 * few pixels -- and a near-zero region is worse than no region at all: every
 * beam's span is then divided by almost nothing, so every fraction passes and
 * the detector reports one line per inked pixel column.
 */
/**
 * The rectangle one drag described, as normalized 0..1 fractions of the
 * drawing, from its two ends in stage pixels. `null` when the gesture does not
 * describe a usable one.
 *
 * This exists because the detector has to be told where the deck is. A deck
 * drawing is not the sheet it is printed on: with nothing but pixels to go on,
 * the strongest full-span line on a real sheet is the page border, not a beam
 * (see InkOptions.region in domain/gridDetect.ts). Auto-cropping was tried
 * first and rejected -- trimming the border then trimming by ink density
 * still put the box around the title block on the customer's own sheet, and a
 * wrong crop produces a plausible-looking wrong grid, which is worse than
 * asking for one drag.
 *
 * Either drag direction gives the same rect, and a drag that runs off the
 * canvas clamps rather than being discarded: dragging past the edge is how you
 * take in the deck's outermost beam.
 */
export function boxFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
  /**
   * The shortest side the drag may describe. The point of a floor at all is
   * that a click, or a drag of a few pixels, reports nothing rather than
   * committing a rectangle nobody meant.
   */
  minFraction: number,
): { x: number; y: number; w: number; h: number } | null {
  // The container is unmeasured on the first render; normalizing by 0 would
  // make every coordinate Infinity and every comparison below meaningless.
  if (width <= 0 || height <= 0) return null

  const fraction = (value: number, extent: number) => Math.min(1, Math.max(0, value / extent))
  const x0 = fraction(Math.min(start.x, end.x), width)
  const x1 = fraction(Math.max(start.x, end.x), width)
  const y0 = fraction(Math.min(start.y, end.y), height)
  const y1 = fraction(Math.max(start.y, end.y), height)

  if (x1 - x0 < minFraction || y1 - y0 < minFraction) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Below this a label is a smudge, not information. A bay too small to carry
 *  its text legibly gets none: the zone legend under the canvas still names it,
 *  and an unreadable overlap costs the drawing underneath for nothing. */
export const MIN_LABEL_FONT_SIZE = 7
/** What a label gets when the bay has room. Matches the drawing's own dimension
 *  text, so the overlay does not shout over the plan. */
export const MAX_LABEL_FONT_SIZE = 12

/**
 * A font size that fits `label` inside a `boxW` x `boxH` bay, or null when the
 * bay is too small to carry it legibly.
 *
 * Fixed at 12px before this, which is why a date range spilled across three
 * neighbouring bays on a dense deck -- see the admin's screenshot. The whole
 * point of the label is to say which plan a bay belongs to, and a label wider
 * than its bay says it about the wrong bay.
 *
 * Width is estimated at 0.55em per character rather than measured. Measuring
 * means a canvas context and a font that has finished loading, neither of which
 * is available while React is deciding what to render; 0.55 is a little generous
 * for the digits and slashes these labels are made of, so the estimate errs
 * toward too small, which is the safe direction.
 *
 * Height is capped at 80% of the bay so the text keeps some air above and below
 * the beam lines it sits between.
 */
export function fitLabelFontSize(
  label: string,
  boxW: number,
  boxH: number,
): number | null {
  if (!label) return null
  const byWidth = boxW / (label.length * 0.55)
  const byHeight = boxH * 0.8
  const size = Math.floor(Math.min(MAX_LABEL_FONT_SIZE, byWidth, byHeight))
  return size >= MIN_LABEL_FONT_SIZE ? size : null
}
