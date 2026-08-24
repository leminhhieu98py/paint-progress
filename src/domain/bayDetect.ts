/**
 * Finds the bays a deck drawing encloses, as closed regions rather than as the
 * crossings of full-width lines.
 *
 * The line-based detector this replaces could not answer one question: where
 * does the deck stop? Every threshold it had was a fraction of the box the
 * admin dragged, so a box with any margin in it put lines through the dimension
 * chain and the title block. Three signals were measured on the customer's real
 * sheet and all three failed to tell a beam from a dimension line:
 *
 *   - Span. The deck's left outer beam covers ~25% of the deck's height (its
 *     corners are cut); the dimension line above the deck covers ~90% of the
 *     width. No bar sits between them.
 *   - Crossings. A dimension line crossed 6 of the 8 detected verticals, because
 *     the dimension chain's extension lines run past the deck.
 *   - A line's own ink. Unreadable: a detected line sits at the mean of a beam's
 *     two drawn faces, which is the white between them.
 *
 * A closed region needs none of that. The margin is not enclosed by anything, so
 * it is one ring-shaped region and is thrown away for barely filling its own
 * bounding box; the bays are enclosed by the beams that draw them. Measured on
 * the real sheet, a box drawn tight, loose and very loose all return the same
 * 129 bays inside the deck, at a median rectangularity of 0.98 -- which is the
 * whole point, since the admin will not drag a careful box.
 *
 * Everything here is pure and works on a plain RGB byte array, so it is
 * exercised with hand-built images; `canvas/rgbFromImage.ts` is the thin,
 * untestable browser half that gets pixels out of a real drawing.
 */

/** A bay, normalized 0..1 over the whole image. */
export interface Bay {
  x: number
  y: number
  w: number
  h: number
}

export interface BayOptions {
  /**
   * Luminance at or below which a pixel counts as ink. Default 200, not the more
   * usual 128: this sheet's CAD hairlines anti-alias to grey when rasterised.
   */
  inkThreshold?: number
  /**
   * How long a run of ink must be, as a fraction of the image width, to count as
   * structure rather than as a glyph. This is what erases the labels, the symbol
   * bubbles and the dimension arrows: none of them holds a straight line for
   * anything like a beam's length. Default 0.004 -- 14px at the 3600px render
   * width, shorter than any bay on the customer's sheet and longer than any
   * character on it.
   */
  minRunFraction?: number
  /**
   * How wide a hole in a beam to bridge, as a fraction of the image width.
   * Beams break where other structure crosses them, and an unbridged break is a
   * door between two bays that the drawing shows as separate. Default 0.0033 --
   * 12px at 3600, measured: 5 gave 102 bays on the real sheet, 8 gave 118, 12
   * gave 137, and past that real bays start merging.
   */
  closeFraction?: number
  /** Smallest bay to report, as a fraction of the box's area. Default 0.0005. */
  minAreaFraction?: number
  /**
   * Largest bay to report, as a fraction of the box's area. Default 0.9.
   *
   * A region that covers nearly the whole box is the box, not a bay: it means
   * nothing inside it enclosed anything, which is what a blank sheet or a box
   * dragged over empty paper looks like. A deck has more than one bay.
   */
  maxAreaFraction?: number
  /**
   * How much of its own bounding box a region must fill to be a bay. Default
   * 0.8. This is what discards the margin: a ring around the deck spans the
   * whole box and fills almost none of it.
   */
  minFill?: number
}

const DEFAULTS = {
  inkThreshold: 200,
  minRunFraction: 0.004,
  closeFraction: 0.0033,
  minAreaFraction: 0.0005,
  maxAreaFraction: 0.9,
  minFill: 0.8,
}

/**
 * Whether the pixel belongs to the sheet's red plan overlay or a yellow fill
 * rather than to a real beam. Both are drawn on the customer's sheet and both
 * are dark enough in places to pass a luminance-only test. The red overlay is
 * the admin's own coarse plan grid -- the thing this feature exists to replace,
 * so detecting it back would defeat the point outright.
 */
function isExcludedColor(r: number, g: number, b: number): boolean {
  if (r - g > 40 && r - b > 40) return true // red plan-grid overlay
  if (r > 180 && g > 180 && b < 140) return true // yellow fill
  return false
}

/**
 * Keeps only the runs of at least `run` set pixels along one axis -- a
 * morphological opening with a 1-D kernel, which is the standard way to pull a
 * table's rules out of a page of text.
 */
function openAlong(
  src: Uint8Array, width: number, height: number, run: number, horizontal: boolean,
): Uint8Array {
  const out = new Uint8Array(width * height)
  const outer = horizontal ? height : width
  const inner = horizontal ? width : height
  const at = (a: number, b: number) => (horizontal ? a * width + b : b * width + a)
  for (let a = 0; a < outer; a++) {
    let start = -1
    for (let b = 0; b <= inner; b++) {
      const on = b < inner && src[at(a, b)] === 1
      if (on) {
        if (start === -1) start = b
      } else if (start !== -1) {
        if (b - start >= run) for (let k = start; k < b; k++) out[at(a, k)] = 1
        start = -1
      }
    }
  }
  return out
}

/**
 * Grows the mask by `radius` and shrinks it back, closing holes narrower than
 * that without moving anything else.
 *
 * Separable, and each step is a running count over the window, so this is O(n)
 * in the pixels rather than O(n · radius²) -- at the 3600px render width the
 * naive form is nine billion operations.
 */
function closeGaps(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return src
  const pass = (m: Uint8Array, horizontal: boolean, grow: boolean) => {
    const out = new Uint8Array(width * height)
    const outer = horizontal ? height : width
    const inner = horizontal ? width : height
    const at = (a: number, b: number) => (horizontal ? a * width + b : b * width + a)
    for (let a = 0; a < outer; a++) {
      let on = 0
      for (let b = 0; b < Math.min(radius, inner); b++) on += m[at(a, b)]
      for (let b = 0; b < inner; b++) {
        const add = b + radius
        if (add < inner) on += m[at(a, add)]
        const drop = b - radius - 1
        if (drop >= 0) on -= m[at(a, drop)]
        const lo = Math.max(0, b - radius)
        const hi = Math.min(inner - 1, b + radius)
        out[at(a, b)] = grow ? (on > 0 ? 1 : 0) : (on === hi - lo + 1 ? 1 : 0)
      }
    }
    return out
  }
  let mask = pass(src, true, true)
  mask = pass(mask, false, true)
  mask = pass(mask, true, false)
  return pass(mask, false, false)
}

/**
 * The bays inside `region`, in reading order.
 *
 * `rgb` is three bytes per pixel, row-major, no alpha. `region` is the box the
 * admin dragged, normalized; its border is treated as structure, so a bay whose
 * own outer beam is interrupted -- which every deck's cut corners produce -- is
 * still closed. That is the only job the box has: it is a wall of last resort,
 * not a measurement, which is why a loose one costs nothing.
 */
export function detectBays(
  rgb: Uint8Array,
  width: number,
  height: number,
  region: { x: number; y: number; w: number; h: number },
  options: BayOptions = {},
): Bay[] {
  const opts = { ...DEFAULTS, ...options }
  const x0 = clamp(Math.round(region.x * width), 0, width - 1)
  const x1 = clamp(Math.round((region.x + region.w) * width) - 1, 0, width - 1)
  const y0 = clamp(Math.round(region.y * height), 0, height - 1)
  const y1 = clamp(Math.round((region.y + region.h) * height) - 1, 0, height - 1)
  if (x1 - x0 < 2 || y1 - y0 < 2) return []

  const ink = new Uint8Array(width * height)
  for (let y = y0; y <= y1; y++) {
    const rowOffset = y * width
    for (let x = x0; x <= x1; x++) {
      const o = (rowOffset + x) * 3
      const r = rgb[o]
      const g = rgb[o + 1]
      const b = rgb[o + 2]
      if (isExcludedColor(r, g, b)) continue
      if (r * 0.299 + g * 0.587 + b * 0.114 <= opts.inkThreshold) ink[rowOffset + x] = 1
    }
  }

  // Structure: the ink that holds a straight line for a beam's length, on either
  // axis. Everything else on the sheet -- every label, bubble and arrowhead --
  // is gone after this.
  const run = Math.max(2, Math.round(opts.minRunFraction * width))
  const horizontal = openAlong(ink, width, height, run, true)
  const vertical = openAlong(ink, width, height, run, false)
  const structure = new Uint8Array(width * height)
  for (let i = 0; i < structure.length; i++) structure[i] = horizontal[i] | vertical[i]

  const wall = closeGaps(structure, width, height, Math.max(1, Math.round(opts.closeFraction * width)))
  for (let x = x0; x <= x1; x++) {
    wall[y0 * width + x] = 1
    wall[y1 * width + x] = 1
  }
  for (let y = y0; y <= y1; y++) {
    wall[y * width + x0] = 1
    wall[y * width + x1] = 1
  }

  // Every connected run of not-wall inside the box is a region. No flood from
  // outside is needed: the box's own border is a wall, so nothing inside is
  // connected to anything outside it.
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const bays: Bay[] = []
  const boxPixels = (x1 - x0 + 1) * (y1 - y0 + 1)
  const minArea = opts.minAreaFraction * boxPixels
  const maxArea = opts.maxAreaFraction * boxPixels

  for (let sy = y0; sy <= y1; sy++) {
    for (let sx = x0; sx <= x1; sx++) {
      const seed = sy * width + sx
      if (seen[seed] || wall[seed]) continue
      let minX = sx
      let maxX = sx
      let minY = sy
      let maxY = sy
      let area = 0
      seen[seed] = 1
      stack.push(seed)
      while (stack.length > 0) {
        const i = stack.pop() as number
        const x = i % width
        const y = (i - x) / width
        area++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        const push = (n: number) => {
          if (!seen[n] && !wall[n]) {
            seen[n] = 1
            stack.push(n)
          }
        }
        if (x > x0) push(i - 1)
        if (x < x1) push(i + 1)
        if (y > y0) push(i - width)
        if (y < y1) push(i + width)
      }
      const boxArea = (maxX - minX + 1) * (maxY - minY + 1)
      if (area < minArea || area > maxArea || area / boxArea < opts.minFill) continue
      bays.push({
        x: minX / width,
        y: minY / height,
        w: (maxX - minX + 1) / width,
        h: (maxY - minY + 1) / height,
      })
    }
  }

  // Reading order: the scan above already walks top to bottom, but a region's
  // first pixel is not its top-left corner once beams slant, so sort explicitly.
  return bays.sort((a, b) => (a.y - b.y) || (a.x - b.x))
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Gives each bay a code by where it sits on the deck: `R<row>C<column>`, rows
 * top to bottom and columns left to right within a row.
 *
 * Rows are the bays' top edges clustered within half the median bay height. Not
 * by vertical overlap: a bay spanning two rows -- which is what a beam stopping
 * part way produces -- overlaps everything below it, and would swallow the next
 * row into its own. Not by an exact shared top either, since no two beams
 * rasterise to the same pixel.
 *
 * The code is the cell's identity for the rest of its life: zone links and the
 * audit trail hang off it, and the GS reads it off the drawing to say which bay
 * they painted. It has to mean something on the sheet.
 */
export function nameBays(bays: Bay[]): (Bay & { code: string })[] {
  if (bays.length === 0) return []
  const heights = bays.map((b) => b.h).sort((a, b) => a - b)
  const tolerance = heights[heights.length >> 1] / 2

  const rows: Bay[][] = []
  let rowTop = Number.NEGATIVE_INFINITY
  for (const bay of [...bays].sort((a, b) => (a.y - b.y) || (a.x - b.x))) {
    if (bay.y - rowTop > tolerance) {
      rows.push([])
      rowTop = bay.y
    }
    rows[rows.length - 1].push(bay)
  }

  return rows.flatMap((row, r) =>
    [...row]
      .sort((a, b) => a.x - b.x)
      .map((bay, c) => ({ ...bay, code: `R${r + 1}C${c + 1}` })),
  )
}
