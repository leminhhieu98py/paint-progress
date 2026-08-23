/**
 * The canvas's view maths, kept out of the component so it can be asserted with
 * literals. Nothing here touches Konva.
 */

/**
 * Width of a guide's grab target, in stage px.
 *
 * The browser session on 2026-08-23 found `hitStrokeWidth: 'auto'` on a 2 px
 * line, i.e. a two-pixel-wide grab target -- fine-ish with a mouse, unusable
 * with a finger. 14 sits in the middle of the 12-16 px range a fingertip needs
 * and stays narrow enough that adjacent guides on a dense mesh do not merge.
 */
export const GUIDE_HIT_WIDTH = 14

/**
 * The half-width of a guide's grab band along its own length, as
 * `[alongPos, halfWidth]` vertices of a piecewise-linear profile. The component
 * paints the polygon these describe as the guide's Konva hit region.
 *
 * `halfWidth` everywhere except near a crossing, where it tapers linearly to 0
 * exactly at the crossing. That taper IS the nearest-guide rule: a point sitting
 * `u` px off this guide's line and `v` px along from a crossing is inside the
 * band iff `u <= min(halfWidth, v)` -- and `v` is precisely its distance from
 * the crossing guide's line. So each pixel near an intersection belongs to
 * whichever guide's line is nearer, the two bands never overlap, and draw order
 * stops deciding anything.
 *
 * This replaces the z-order lottery the browser session hit: aiming at a
 * vertical guide near an intersection grabbed the horizontal one and moved the
 * wrong axis of the mm chain, which silently rewrites every cell area on the
 * deck. A dead region at each crossing was considered and rejected -- dragging
 * that does nothing, with no feedback saying why, is worse than a wrong grab is
 * rare.
 */
export function guideHitProfile(
  length: number,
  crossings: number[],
  halfWidth: number,
): [number, number][] {
  if (length <= 0) return []

  const halfWidthAt = (at: number) =>
    crossings.reduce((narrowest, c) => Math.min(narrowest, Math.abs(at - c)), halfWidth)

  // A vertex wherever the profile changes slope: the two shoulders of every
  // crossing and the crossing itself, plus both ends of the guide. Anything
  // outside the guide's own extent is dropped rather than clamped -- a clamp
  // would put two vertices at the same position with different widths.
  const knots = new Set<number>([0, length])
  for (const crossing of crossings) {
    for (const at of [crossing - halfWidth, crossing, crossing + halfWidth]) {
      if (at > 0 && at < length) knots.add(at)
    }
  }

  return [...knots]
    .sort((a, b) => a - b)
    .map((at): [number, number] => [at, halfWidthAt(at)])
}

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
