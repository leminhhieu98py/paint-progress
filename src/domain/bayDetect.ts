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
   *
   * Beams break wherever the sheet draws something over them -- a symbol bubble,
   * a pedestal outline, a leader line -- and an unbridged break is a door
   * between two bays the drawing shows as separate, so the two come back as one
   * region running the width of the deck. The holes are far wider than a beam is
   * thick, which is why the bridge is closed along the beam's own axis (see
   * closeAlong) and can be this large.
   *
   * Default 0.025 -- 90px on the real sheet at 3600px, measured there: 12px gave
   * 103 bays covering 63% of the deck, 29px gave 123 at 66%, 54px gave 145 at
   * 63%, 90px gave 163 at 68%, 144px gave 220 at 70% but started bridging the
   * dimension chain into the deck. The ceiling is ~78%: the beams themselves are
   * the rest of it.
   */
  closeFraction?: number
  /**
   * How much of a line's own length must be inked for it to be a beam's
   * centreline, once the dashes are bridged. Default 0.7.
   *
   * Measured against the DECK's width or height, not the box's -- which is why
   * the deck has to be found first. Against the box, a very loose one dropped
   * the count from 24 horizontal lines to 2, because a beam spanning the whole
   * deck spans only 63% of a box drawn well outside it.
   */
  minCentrelineCover?: number
  /**
   * The widest gap between two dashes of a centreline, as a fraction of the
   * image width. Default 0.0033 -- 12px at 3600.
   */
  dashGapFraction?: number
  /**
   * How much of a grid ROW or COLUMN must be enclosed by the drawing for it to
   * be part of the deck, as a fraction of the band's own area. Default 0.1.
   *
   * The grid comes from centrelines that span the deck, so it also spans
   * anything the deck's extent was dragged over -- and a box left loose drags it
   * onto the title block. A band that encloses nothing anywhere along it is not
   * deck.
   */
  minEnclosed?: number
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
  /**
   * How much of a line segment must be inked for it to count as the deck's own
   * edge. Default 0.85.
   *
   * Deliberately not 1: a beam is interrupted wherever the sheet draws a
   * pedestal, a bubble or a leader line over it, and an edge that had to be
   * unbroken would be found nowhere on a real drawing.
   */
  solidCover?: number
  /**
   * How much of a grid cell must fall inside the deck for the cell to be kept.
   * Default 0.35.
   *
   * Low on purpose. Dropping a cell is a one-way loss -- the admin can delete a
   * cell they did not want, but a cell that was never proposed can only be got
   * back by re-detecting the whole deck -- so this only removes cells that are
   * mostly outside.
   */
  minCellCover?: number
}

const DEFAULTS = {
  inkThreshold: 200,
  minRunFraction: 0.004,
  closeFraction: 0.025,
  minAreaFraction: 0.0005,
  minCentrelineCover: 0.7,
  minEnclosed: 0.1,
  dashGapFraction: 0.0033,
  maxAreaFraction: 0.9,
  minFill: 0.8,
  solidCover: 0.85,
  minCellCover: 0.35,
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
 * Grows then shrinks the mask by `radius` ALONG ONE AXIS, closing holes in a
 * line without fattening it sideways.
 *
 * One axis, not a square kernel, and this is the difference between the grid
 * working and not. A beam is interrupted wherever a symbol bubble, a pedestal
 * outline or a leader line is drawn over it, and those holes are far wider than
 * a beam is thick -- but a square kernel big enough to bridge them also welds
 * neighbouring parallel beams together, so raising it made the result worse:
 * measured on the real sheet with a square kernel, 12px gave 135 bays, 18px
 * gave 124, 25px gave 113 -- it got worse as it got bigger.
 * Closing a horizontal line along x and a vertical one along y bridges the holes
 * and leaves the gap between parallel beams untouched.
 *
 * Separable and O(n) in the pixels: each step is a running count over the
 * window, since at the 3000px render width the naive form is billions of
 * operations.
 */
function closeAlong(
  src: Uint8Array, width: number, height: number, radius: number, horizontal: boolean,
): Uint8Array {
  if (radius <= 0) return src
  const pass = (m: Uint8Array, grow: boolean) => {
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
  return pass(pass(src, true), false)
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
function enclosedRegions(
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
  const bridge = Math.max(1, Math.round(opts.closeFraction * width))
  const horizontal = closeAlong(openAlong(ink, width, height, run, true), width, height, bridge, true)
  const vertical = closeAlong(openAlong(ink, width, height, run, false), width, height, bridge, false)
  const wall = new Uint8Array(width * height)
  for (let i = 0; i < wall.length; i++) wall[i] = horizontal[i] | vertical[i]
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

/**
 * The ink mask over a box, with the red plan overlay counted IN.
 *
 * Red is excluded everywhere else, because it is the admin's own coarse plan
 * grid and detecting it back would defeat the point. Here it is kept: on this
 * sheet the red is drawn along beam centrelines, so a beam it covers would
 * otherwise have no centreline to find.
 */
function inkOf(
  rgb: Uint8Array, width: number, height: number,
  box: { x0: number; x1: number; y0: number; y1: number }, threshold: number,
): Uint8Array {
  const ink = new Uint8Array(width * height)
  for (let y = box.y0; y <= box.y1; y++) {
    const rowOffset = y * width
    for (let x = box.x0; x <= box.x1; x++) {
      const o = (rowOffset + x) * 3
      const r = rgb[o]
      const g = rgb[o + 1]
      const b = rgb[o + 2]
      if (r > 180 && g > 180 && b < 140) continue // yellow fill
      const red = r - g > 40 && r - b > 40
      if (red || r * 0.299 + g * 0.587 + b * 0.114 <= threshold) ink[rowOffset + x] = 1
    }
  }
  return ink
}

/**
 * The positions of the beams' dashed centrelines on one axis, inside `box`.
 *
 * A beam on this sheet is drawn as two solid lines with a DASHED line down the
 * middle, and it is the dashed one that marks the beam's axis -- which is where
 * the admin draws a bay's boundary by hand, so the bays tile the deck with no
 * gap for the beam's thickness.
 *
 * Finding it takes two readings of the same line. `solid` is the fraction of the
 * line that is inked outright; `bridged` counts each inked pixel as covering the
 * run back to the previous one, up to `gap`, which closes a dash's gaps. A solid
 * flank reads the same either way; a dashed line reads far higher bridged than
 * solid, and that difference is what picks it out of the band. Taking the band's
 * middle instead put the boundary on a flank -- visibly off-centre at any zoom,
 * and the admin said so.
 *
 * Where a band has no dashes at all -- a dimension rule, or a beam whose dashes
 * the render blurred away -- every row reads alike and the middle is used, which
 * is the best available answer.
 *
 * A rule requiring two solid flanks either side was tried, as the drawing's own
 * convention suggests. It was dropped: measured on the real sheet it rejected a
 * fifth of the real lines (24 horizontal became 19) and removed none of the
 * lines outside the deck, which is the only thing it was meant to buy.
 */
function centrelines(
  ink: Uint8Array, width: number,
  box: { x0: number; x1: number; y0: number; y1: number },
  horizontal: boolean, minCover: number, gap: number,
): number[] {
  const from = horizontal ? box.y0 : box.x0
  const to = horizontal ? box.y1 : box.x1
  const alongFrom = horizontal ? box.x0 : box.y0
  const alongTo = horizontal ? box.x1 : box.y1
  const span = alongTo - alongFrom + 1

  const solid: number[] = []
  const bridged: number[] = []
  for (let at = from; at <= to; at++) {
    let inked = 0
    let joined = 0
    let last = alongFrom - gap - 1
    for (let i = alongFrom; i <= alongTo; i++) {
      if (ink[horizontal ? at * width + i : i * width + at]) {
        inked++
        joined += Math.min(i - last, gap + 1)
        last = i
      }
    }
    solid.push(inked / span)
    bridged.push(joined / span)
  }

  // Each run of rows over the bar is a candidate band. Its dashed row, if it has
  // one, is the row the bridging helped most.
  const DASH_ENOUGH = 0.05
  const found: { at: number; from: number; to: number; dash: number }[] = []
  let start = -1
  for (let i = 0; i <= bridged.length; i++) {
    const over = i < bridged.length && bridged[i] >= minCover
    if (over) {
      if (start === -1) start = i
      continue
    }
    if (start === -1) continue
    let best = start
    let bestDash = bridged[start] - solid[start]
    for (let k = start; k < i; k++) {
      const dash = bridged[k] - solid[k]
      if (dash > bestDash) {
        best = k
        bestDash = dash
      }
    }
    found.push({ at: from + best, from: from + start, to: from + i - 1, dash: bestDash })
    start = -1
  }
  if (found.length < 3) return found.map((f) => (f.dash >= DASH_ENOUGH ? f.at : (f.from + f.to) >> 1))

  // One beam, one line.
  //
  // A beam reaches here as one band when its dashes survived the render, and as
  // two -- its solid flanks, with the dashes lost between them -- when they did
  // not. Measured on the admin's own uploaded drawing, which is stored at
  // 1622px: across a beam the flanks read 82% and 59% while the three rows
  // between them read 5-7%, because at that size a dash is under a pixel wide.
  // Both cases give the beam's axis: the dashed row where there is one, the
  // middle of the flanks where there is not.
  //
  // Bands closer together than a sixth of the bay pitch are the same beam. The
  // pitch is the median of the LARGER half of the gaps, not of all of them: when
  // every beam arrives as a flank pair, half the gaps are a beam's own thickness
  // and the plain median lands between the two populations, which left every
  // beam with a boundary on each side and a sliver of a cell between them.
  const gaps = found.slice(1).map((f, i) => f.from - found[i].to).sort((a, b) => a - b)
  const wide = gaps.slice(gaps.length >> 1)
  const together = wide[wide.length >> 1] / 6

  const lines: number[] = []
  let group: typeof found = []
  const flush = () => {
    if (group.length === 0) return
    const dashed = group.reduce((best, f) => (f.dash > best.dash ? f : best))
    lines.push(dashed.dash >= DASH_ENOUGH
      ? dashed.at
      : (group[0].from + group[group.length - 1].to) >> 1)
    group = []
  }
  for (const f of found) {
    if (group.length > 0 && f.from - group[group.length - 1].to > together) flush()
    group.push(f)
  }
  flush()
  return lines
}

/**
 * Adds a line at the deck's own edge where the outermost beam did not produce
 * one, so the bays along the boundary exist.
 *
 * The deck's outer beams are the ones a centreline is hardest to read from:
 * their corners are cut, so they span less of the deck than any beam inside it
 * and fall below the bar. The whole boundary strip of bays then has no closing
 * line and simply is not there -- the admin found exactly that, and said the
 * gaps were at the edges, next to where they had cropped.
 *
 * `lo` and `hi` are the extent of the enclosed regions, which is the INNER face
 * of those outer beams: a boundary bay reaches the beam's face rather than its
 * axis, a fraction of a beam short. Present and a few pixels small beats absent.
 *
 * Only when the outermost line is a real distance inside the deck -- a third of
 * the bay pitch -- since a beam that did read is already the right line and a
 * second one beside it would make a sliver.
 */
/**
 * How far the deck itself reaches across one band, as the first and last
 * position carrying a solid line.
 *
 * The grid is a product: every x line crossed with every y line. A deck that is
 * not a rectangle -- and a real one rarely is -- gets cells proposed in the
 * corners it does not reach into. Measured on the customer's sheet, the grid put
 * the left edge at x=729 for all 22 rows while the deck's own left edge stood at
 * 854 for the top seven of them, so a whole column of cells sat 125px out in the
 * margin; the bottom row sat below the deck entirely.
 *
 * A band is bounded by two beams, so the deck's edge inside it is a single
 * unbroken line and reads as one. Scanning inward from each side finds it: the
 * first solid line from the left IS the left edge, because anything further left
 * would have to be outside the deck. Interior beams are solid too, which is why
 * the scan has to start at the outside and stop at the first hit.
 *
 * `null` when the band carries no solid line at all -- an empty band, or one
 * whose edges the render lost. The caller leaves such a band uncut rather than
 * emptying it: this rule exists to remove cells that are demonstrably outside,
 * not to remove cells it cannot see.
 *
 * The step is assumed to fall ON a grid line, which is what a deck drawn to a
 * beam grid does -- the customer's sheet steps at 854 against a line at 859.
 * A deck that stepped in the MIDDLE of a bay would have that bay measured
 * against the wrong extent; nothing here would notice.
 */
function deckSpan(
  ink: Uint8Array, width: number,
  from: number, to: number, lo: number, hi: number,
  horizontal: boolean, solidCover: number,
): { first: number; last: number } | null {
  const span = to - from + 1
  const solid = (at: number) => {
    let inked = 0
    for (let i = from; i <= to; i++) if (ink[horizontal ? at * width + i : i * width + at]) inked++
    return inked / span >= solidCover
  }
  let first: number | null = null
  for (let at = lo; at <= hi; at++) {
    if (solid(at)) { first = at; break }
  }
  if (first === null) return null
  let last = first
  for (let at = hi; at > first; at--) {
    if (solid(at)) { last = at; break }
  }
  return { first, last }
}

function closeAtDeckEdge(lines: number[], lo: number, hi: number): number[] {
  if (lines.length < 2) return lines
  const gaps = lines.slice(1).map((at, i) => at - lines[i]).sort((a, b) => a - b)
  const room = gaps[gaps.length >> 1] / 3
  const out = [...lines]
  if (out[0] - lo > room) out.unshift(lo)
  if (hi - out[out.length - 1] > room) out.push(hi)
  return out
}

/**
 * The bays of the deck inside `region`, in reading order.
 *
 * Two stages, because the two questions want different tools:
 *
 *   1. WHERE IS THE DECK. The enclosed-region pass answers this the same way
 *      whatever box it is given -- measured on the real sheet, a tight, a loose
 *      and a very loose box all put the deck's left and right edges within 2px
 *      of each other. Nothing else tried came close; see the module docblock.
 *   2. WHERE ARE ITS BAYS. Inside that extent, the beams' dashed centrelines,
 *      measured against the DECK's own width and height. Against the box's, a
 *      very loose one dropped the horizontal line count from 24 to 2.
 *
 * The result is a tiling: bays meet along the beams' axes with no gap between
 * them, which is how the admin draws it by hand. Measured on the real sheet, all
 * three boxes returned the same 168 bays.
 *
 * Falls back to the enclosed regions themselves when the centrelines do not
 * describe a grid -- a sheet drawn to another convention, where a bay is still
 * a bay even if nothing on it is dashed.
 */
export function detectBays(
  rgb: Uint8Array,
  width: number,
  height: number,
  region: { x: number; y: number; w: number; h: number },
  options: BayOptions = {},
): Bay[] {
  const opts = { ...DEFAULTS, ...options }
  const regions = enclosedRegions(rgb, width, height, region, options)
  if (regions.length === 0) return []

  // Padded by a beam's own thickness: the regions sit BETWEEN the beams, so
  // their union stops at the outer beams' inner faces and the outermost
  // centrelines -- the deck's own edges -- would fall outside the box that
  // looks for them.
  const pad = Math.max(1, Math.round(opts.closeFraction * width / 4))
  const box = {
    x0: Math.round(Math.min(...regions.map((b) => b.x)) * width),
    x1: Math.round(Math.max(...regions.map((b) => b.x + b.w)) * width) - 1,
    y0: Math.round(Math.min(...regions.map((b) => b.y)) * height),
    y1: Math.round(Math.max(...regions.map((b) => b.y + b.h)) * height) - 1,
  }
  const deck = {
    x0: Math.max(0, box.x0 - pad),
    x1: Math.min(width - 1, box.x1 + pad),
    y0: Math.max(0, box.y0 - pad),
    y1: Math.min(height - 1, box.y1 + pad),
  }
  const ink = inkOf(rgb, width, height, deck, opts.inkThreshold)
  const gap = Math.max(1, Math.round(opts.dashGapFraction * width))
  const xs = closeAtDeckEdge(centrelines(ink, width, deck, false, opts.minCentrelineCover, gap), box.x0, box.x1)
  const ys = closeAtDeckEdge(centrelines(ink, width, deck, true, opts.minCentrelineCover, gap), box.y0, box.y1)
  if (xs.length < 2 || ys.length < 2) return regions

  // Whole rows and columns, not single cells. The grid spans whatever the deck's
  // extent turned out to be, and a box left loose drags that extent past the
  // deck -- on the real sheet, two bay-rows down onto the title block. Those
  // rows enclose nothing anywhere along them, so they go.
  //
  // Per CELL this rule punched holes in the middle of the deck: 46 of 184 cells
  // enclose nothing because they sit on solid structure -- the E-house, the
  // pedestals, the hatched columns -- and those are still deck to paint.
  const overlap = (bay: Bay, region: Bay) => {
    const w = Math.min(bay.x + bay.w, region.x + region.w) - Math.max(bay.x, region.x)
    const h = Math.min(bay.y + bay.h, region.y + region.h) - Math.max(bay.y, region.y)
    return w > 0 && h > 0 ? w * h : 0
  }
  const bandHasBays = (from: number, to: number, vertical: boolean) => {
    const band: Bay = vertical
      ? { x: from / width, y: 0, w: (to - from) / width, h: 1 }
      : { x: 0, y: from / height, w: 1, h: (to - from) / height }
    const enclosed = regions.reduce((sum, region) => sum + overlap(band, region), 0)
    return enclosed >= opts.minEnclosed * band.w * band.h
  }

  // Where the deck actually reaches, band by band, so the corners it does not
  // reach into stop being proposed. Measured once per band rather than once per
  // cell: a band is bounded by two beams, so its extent is one number.
  const rows = ys.slice(0, -1).map((_y, r) =>
    deckSpan(ink, width, ys[r], ys[r + 1], deck.x0, deck.x1, false, opts.solidCover))
  const cols = xs.slice(0, -1).map((_x, c) =>
    deckSpan(ink, width, xs[c], xs[c + 1], deck.y0, deck.y1, true, opts.solidCover))

  /** How much of [from,to] lies inside the band's own extent, as a fraction. */
  const inside = (from: number, to: number, extent: { first: number; last: number } | null) => {
    if (!extent) return 1
    return Math.max(0, Math.min(to, extent.last) - Math.max(from, extent.first)) / (to - from)
  }

  const bays: Bay[] = []
  for (let r = 0; r < ys.length - 1; r++) {
    if (!bandHasBays(ys[r], ys[r + 1], false)) continue
    for (let c = 0; c < xs.length - 1; c++) {
      if (!bandHasBays(xs[c], xs[c + 1], true)) continue
      // Both axes, and the cell is kept whole or not at all. Trimming it to the
      // measured edge was tried and dropped: the edge reads a few pixels off the
      // grid line it belongs to -- 854 against 859 on the customer's sheet --
      // and trimming to it leaves every boundary bay a sliver out of step with
      // the column beside it. Dropping whole cells gives the same staircase and
      // keeps every bay on the beam grid.
      if (inside(xs[c], xs[c + 1], rows[r]) < opts.minCellCover) continue
      if (inside(ys[r], ys[r + 1], cols[c]) < opts.minCellCover) continue
      bays.push({
        x: xs[c] / width,
        y: ys[r] / height,
        w: (xs[c + 1] - xs[c]) / width,
        h: (ys[r + 1] - ys[r]) / height,
      })
    }
  }
  return bays
}
