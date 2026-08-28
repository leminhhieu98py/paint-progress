/**
 * The tile a hatched bay is filled with.
 *
 * One diagonal band of translucent white, drawn three times so the tile repeats
 * seamlessly across its own edges: the band that leaves the top-right corner
 * has to re-enter at the bottom-left, or every tile boundary shows as a seam
 * across a 180-bay drawing.
 *
 * White rather than a colour of its own. The hatch sits ON TOP of a bay that is
 * already carrying a meaningful fill -- a zone colour, or a coat colour -- and
 * the fill underneath has to stay identifiable through it. Anything saturated
 * would become a sixth colour on a drawing that already has five.
 */
const TILE = 8
const BAND = 3
const INK = 'rgba(255, 255, 255, 0.78)'

/**
 * Returns null where there is no 2D context to draw into.
 *
 * jsdom implements no canvas, so this is the normal answer under test, and
 * `DrawingCanvas` renders the bays unhatched rather than crashing. It is worth
 * saying plainly: a passing test suite is NOT evidence that the hatch renders.
 * The pattern's geometry is asserted in the browser, by eye.
 */
export function createHatchPattern(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.strokeStyle = INK
  ctx.lineWidth = BAND
  ctx.beginPath()
  // The three passes are one band and its two wrapped halves.
  ctx.moveTo(-TILE / 2, TILE / 2)
  ctx.lineTo(TILE / 2, -TILE / 2)
  ctx.moveTo(0, TILE)
  ctx.lineTo(TILE, 0)
  ctx.moveTo(TILE / 2, TILE * 1.5)
  ctx.lineTo(TILE * 1.5, TILE / 2)
  ctx.stroke()

  return canvas
}
