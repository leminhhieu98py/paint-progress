import { paintLensColors } from '../domain/lens'
import { buildStageSlices } from '../domain/pieSlices'
import type { Cell, Stage } from '../domain/types'

/**
 * Pictures of a deck for the report, taken without mounting anything.
 *
 * Spec §9 asks the per-deck sheets to carry the drawing and the pie. The export
 * runs over EVERY deck of a project while at most one is on screen, so both are
 * drawn straight onto a detached `<canvas>` with the 2D context.
 *
 * Deliberately not Konva rendered offscreen. That would mean
 * mounting a React tree into a hidden node, waiting for a paint, and reading it
 * back -- three things that can hang, for pictures that are two flat fills and a
 * ring of arcs. The colours come from the same `paintLensColors` and
 * `buildStageSlices` the screen uses, so the picture in the workbook and the
 * picture on screen cannot drift apart.
 *
 * Every function here returns `null` rather than throwing. A deck whose drawing
 * will not load must still get its numbers into the report; losing a picture is
 * a much smaller loss than losing the export.
 */

/** Wide enough to read bay codes when the sheet is printed, small enough that a
 *  ten-deck workbook stays a few megabytes. */
const DRAWING_WIDTH = 1400
const PIE_SIZE = 520
/*
  The ring is only half the picture. Without a key it is five wedges of colour
  and no way to tell which coat is which -- the workbook goes to someone who has
  never opened the app and has no palette to compare against, so the legend has
  to travel inside the PNG. Drawn here rather than laid into Excel cells because
  a picture cannot drift out of alignment with itself.
*/
const PIE_LEGEND_ROW = 40
const PIE_LEGEND_TOP = 24
const PIE_WIDTH = PIE_SIZE + 360

/** Matches DrawingCanvas, so a bay is the same shade in the workbook as on the
 *  screen the admin approved. */
const STAGE_FILL_OPACITY = 0.45

function toDataUrlBase64(canvas: HTMLCanvasElement): string | null {
  try {
    // ExcelJS wants the payload without the `data:image/png;base64,` prefix.
    return canvas.toDataURL('image/png').split(',')[1] ?? null
  } catch {
    // A canvas tainted by a cross-origin image throws here. The signed URL is
    // same-origin-ish but the storage host is not, so this is reachable.
    return null
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // Without this the canvas is tainted and toDataURL throws; Supabase storage
    // answers with permissive CORS, so the request itself is unaffected.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * The deck's drawing with every bay filled by the coat it has reached.
 *
 * Cell geometry is normalised 0..1 against the drawing, so it scales with
 * whatever width the snapshot is taken at.
 */
export async function renderDeckDrawing(
  imageUrl: string,
  imageW: number,
  imageH: number,
  cells: Cell[],
  stages: Stage[],
): Promise<string | null> {
  if (!imageW || !imageH) return null
  const img = await loadImage(imageUrl)
  if (!img) return null

  const scale = DRAWING_WIDTH / imageW
  const canvas = document.createElement('canvas')
  canvas.width = DRAWING_WIDTH
  canvas.height = Math.round(imageH * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // White underneath: a PNG with an alpha channel lands on Excel's own grey and
  // the linework disappears.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const colors = paintLensColors(cells, stages)
  ctx.globalAlpha = STAGE_FILL_OPACITY
  for (const cell of cells) {
    const color = colors[cell.code]
    if (!color) continue
    ctx.fillStyle = color
    ctx.fillRect(
      cell.x * canvas.width,
      cell.y * canvas.height,
      cell.w * canvas.width,
      cell.h * canvas.height,
    )
  }
  ctx.globalAlpha = 1

  return toDataUrlBase64(canvas)
}

/**
 * The same doughnut the GS screen shows, drawn as arcs.
 *
 * Shares are taken from each slice's area over the SUM OF THE SLICES, which is
 * the deck's declared area by construction -- `buildStageSlices` adds the
 * unmapped remainder for exactly this reason. Dividing by Σ cell.areaM2 instead
 * would renormalise the picture away from every printed number beside it.
 */
export function renderDeckPie(
  totalAreaM2: number,
  cells: Cell[],
  stages: Stage[],
): string | null {
  const slices = buildStageSlices(totalAreaM2, cells, stages)
  const total = slices.reduce((sum, s) => sum + s.areaM2, 0)
  if (total <= 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = PIE_WIDTH
  canvas.height = PIE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PIE_WIDTH, PIE_SIZE)

  const cx = PIE_SIZE / 2
  const cy = PIE_SIZE / 2
  const outer = PIE_SIZE * 0.42
  const inner = outer * 0.6
  // From twelve o'clock, clockwise -- the direction the on-screen ring draws it, so the
  // workbook and the screen read the same way round.
  let angle = -Math.PI / 2

  for (const slice of slices) {
    if (slice.areaM2 <= 0) continue
    const sweep = (slice.areaM2 / total) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(cx, cy, outer, angle, angle + sweep)
    ctx.arc(cx, cy, inner, angle + sweep, angle, true)
    ctx.closePath()
    ctx.fillStyle = slice.color
    ctx.fill()
    angle += sweep
  }

  /*
    The key, beside the ring: swatch, coat name, area and share.

    Every slice is listed, including one at zero -- a coat nobody has started is
    a fact about the deck, and dropping it would make a five-coat spec look like
    a four-coat one. The share divides by the ring's own total, so the printed
    percentages add to 100 and match the wedge they sit beside.
  */
  ctx.textBaseline = 'middle'
  const legendX = PIE_SIZE + 12
  slices.forEach((slice, i) => {
    const y = PIE_LEGEND_TOP + i * PIE_LEGEND_ROW + PIE_LEGEND_ROW / 2

    ctx.fillStyle = slice.color
    ctx.fillRect(legendX, y - 9, 18, 18)
    ctx.strokeStyle = '#16202b33'
    ctx.lineWidth = 1
    ctx.strokeRect(legendX + 0.5, y - 8.5, 17, 17)

    ctx.fillStyle = '#16202b'
    ctx.font = '600 15px sans-serif'
    ctx.fillText(slice.label, legendX + 28, y)

    ctx.fillStyle = '#4a5a6b'
    ctx.font = '400 14px sans-serif'
    const share = total > 0 ? (slice.areaM2 / total) * 100 : 0
    ctx.fillText(
      `${slice.areaM2.toFixed(2)} m² · ${share.toFixed(2)}%`,
      legendX + 28,
      y + 17,
    )
  })

  return toDataUrlBase64(canvas)
}
