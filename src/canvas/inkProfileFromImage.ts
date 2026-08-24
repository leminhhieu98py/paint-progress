import { inkProfile, type InkOptions, type InkProfile } from '../domain/gridDetect'

/**
 * Render width for detection, in pixels. Non-negotiable, not a tuning knob:
 * probed against the customer's real Main Deck sheet, at 1200px wide the
 * deck is only 460px across and its densest column of ink covers 10% of the
 * drawing's height; at 3600px the same column covers 85%. Below ~3000px the
 * beams are too thin, relative to the whole image, for any fraction to find
 * them -- that is a resolution problem, not a threshold one, and no amount
 * of retuning `inkThreshold` or the sliders' fraction fixes it. See
 * `.superpowers/sdd/phase-3/detect-sliders-brief.md`.
 */
export const INK_PROFILE_RENDER_WIDTH = 3000

/**
 * Loads the drawing at `imageUrl`, rasterises it at `INK_PROFILE_RENDER_WIDTH`
 * on an offscreen canvas, and runs the expensive `inkProfile` pass over its
 * pixels once.
 *
 * This is the thin, untestable browser half: jsdom has no canvas, so nothing
 * in this file can be exercised by a unit test, and by design nothing in it
 * makes a detection decision. Every line that COULD live in the pure
 * `inkProfile` does -- resist adding logic here for convenience; add it to
 * `domain/gridDetect.ts` and cover it with a synthetic-image test instead.
 */
export async function inkProfileFromImage(imageUrl: string, options?: InkOptions): Promise<InkProfile> {
  const image = await loadImage(imageUrl)

  const width = INK_PROFILE_RENDER_WIDTH
  const height = Math.max(1, Math.round(image.height * (width / image.width)))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not get a 2d canvas context')
  context.drawImage(image, 0, 0, width, height)

  const { data } = context.getImageData(0, 0, width, height)
  // getImageData returns RGBA; inkProfile reads plain RGB triples, so the
  // alpha byte is dropped on the way in rather than carried through as dead
  // weight in every pixel test downstream.
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    rgb[o] = data[i]
    rgb[o + 1] = data[i + 1]
    rgb[o + 2] = data[i + 2]
  }

  return inkProfile(rgb, width, height, options)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // Anonymous CORS: without it, a cross-origin image (the drawing is
    // served from Supabase Storage, a different origin than the app in
    // every real deployment) taints the canvas and getImageData throws
    // SecurityError instead of handing back pixels.
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Không tải được ảnh bản vẽ để dò lưới'))
    image.src = src
  })
}
