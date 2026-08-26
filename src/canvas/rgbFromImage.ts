import { deckRegion, detectBays, type Bay, type BayOptions } from '../domain/bayDetect'

/**
 * Render width for detection, in pixels. Non-negotiable, not a tuning knob:
 * probed against the customer's real Main Deck sheet, at 1200px wide the deck is
 * only 460px across and its densest column of ink covers 10% of the drawing's
 * height; at 3600px the same column covers 85%. Below ~3000px the beams are too
 * thin, relative to the whole image, for anything to find them -- that is a
 * resolution problem, not a threshold one.
 */
export const DETECT_RENDER_WIDTH = 3000

/**
 * Loads the drawing at `imageUrl`, rasterises it at `DETECT_RENDER_WIDTH` on an
 * offscreen canvas, and hands its pixels to the pure `detectBays`.
 *
 * This is the thin, untestable browser half: jsdom has no canvas, so nothing in
 * this file can be exercised by a unit test, and by design nothing in it makes a
 * detection decision. Every line that COULD live in `domain/bayDetect.ts` does.
 */
export async function detectBaysFromImage(
  imageUrl: string,
  options?: BayOptions,
): Promise<Bay[]> {
  const image = await loadImage(imageUrl)

  const width = DETECT_RENDER_WIDTH
  const height = Math.max(1, Math.round(image.height * (width / image.width)))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not get a 2d canvas context')
  context.drawImage(image, 0, 0, width, height)

  const { data } = context.getImageData(0, 0, width, height)
  // getImageData returns RGBA; detectBays reads plain RGB triples, so the alpha
  // byte is dropped on the way in rather than carried as dead weight through
  // every pixel test downstream.
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    rgb[o] = data[i]
    rgb[o + 1] = data[i + 1]
    rgb[o + 2] = data[i + 2]
  }

  // Where the deck is, rather than where the admin said it was. They used to
  // drag a box round it first; deckRegion reads the same thing off the sheet --
  // measured on the customer's drawing, 184 bays against 182 for the box they
  // dragged by hand.
  const region = deckRegion(rgb, width, height, options)
  if (!region) return []
  return detectBays(rgb, width, height, region, options)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // Anonymous CORS: without it a cross-origin image -- the drawing is served
    // from Supabase Storage, a different origin than the app in every real
    // deployment -- taints the canvas and getImageData throws SecurityError
    // instead of handing back pixels.
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Không tải được ảnh bản vẽ để dò lưới'))
    image.src = src
  })
}
