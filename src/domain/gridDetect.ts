/**
 * Detects the beam grid straight from the drawing's own pixels.
 *
 * See `.superpowers/sdd/phase-3/grid-detect-brief.md` for why pixels are the
 * only source of the mesh at all (the admin's source PDF is a raster image
 * with no embedded text, and the cells they want are bounded by every beam,
 * including intermediate ones that carry no printed dimension), and
 * `.superpowers/sdd/phase-3/detect-sliders-brief.md` for why the single
 * `minSpanFraction` from that first attempt is gone: measured against the
 * customer's real Main Deck sheet, horizontal beams detect well from 0.6-0.7
 * while vertical beams under-detect at every fraction tried (5-9 lines) --
 * they are genuinely interrupted by the diagonal brace, two circular
 * structures mid-deck, and the E-house, so their ink columns are broken
 * where the horizontal stiffeners run clean. That asymmetry is a property of
 * deck structures, not an artefact, so there is no single fraction right for
 * both axes, and the fraction becomes a per-axis control instead of a
 * constant.
 *
 * Everything that decides WHERE a line is lives here, over a plain RGB byte
 * array, so it can be exercised with hand-built synthetic images and needs no
 * canvas. `canvas/inkProfileFromImage.ts` is the thin, untestable browser half
 * that gets pixels out of a real drawing and hands them to `inkProfile` --
 * resist moving any of this back out to it for convenience.
 *
 * Split into an expensive pass and a cheap one so the sensitivity sliders can
 * feel live: `inkProfile` walks every pixel once (~9M luminance/colour tests
 * at the 3000px render width this needs -- tens of ms) and caches the
 * per-column and per-row ink counts; `linesFromProfile` re-compares those
 * cached counts against a new fraction, which is a pass over a few thousand
 * numbers and is effectively instant. A slider tick must never re-run the ink
 * pass -- that is the whole performance case for the split.
 */

/** One RGB pixel already decided to be ink (dark, and not an excluded colour). */
export interface InkOptions {
  /**
   * Luminance at or below which a pixel counts as ink, once colour-excluded.
   * Default 200, not the more usual 128: this sheet's CAD hairlines
   * anti-alias to grey when rasterised, and 128 missed them on the customer's
   * real drawing.
   */
  inkThreshold?: number
  /**
   * Candidate columns (or rows) closer together than this fraction of the
   * width (or height) merge into one line. Default 0.004.
   */
  mergeWithin?: number
  /**
   * The deck's own rectangle on the sheet, normalized 0..1 over the whole
   * image. Ink outside it is not counted at all, and the region -- not the
   * ink's bounding box -- becomes the content box every line is measured
   * against.
   *
   * This is the difference between detection working and detection returning
   * nothing on a real sheet. A deck drawing is not the sheet it is printed
   * on: the customer's Main Deck occupies roughly 40% of its A3 page, and the
   * page carries a border, a title block and off-deck structure. With no
   * region the content box is the ink bounding box, which IS the page border
   * -- so every real beam spans about 40% of it and is rejected at any usable
   * fraction, while the border spans 100% and is reported as a beam. The
   * browser harness on the real sheet found exactly that: one line, zero
   * cells. Omit it only for a synthetic image that is nothing but the drawing.
   */
  region?: { x: number; y: number; w: number; h: number }
}

const DEFAULT_INK_THRESHOLD = 200
const DEFAULT_MERGE_WITHIN = 0.004

/**
 * The per-column and per-row ink counts, plus the content box, computed once
 * over the whole image. Opaque to callers other than `linesFromProfile` --
 * treat it as a token to cache and pass back in, not as data to read fields
 * off of.
 */
export interface InkProfile {
  /** Inked pixel count per column, index = x. */
  colInk: number[]
  /** Inked pixel count per row, index = y. */
  rowInk: number[]
  /**
   * The box every line's span is measured against: `InkOptions.region` in
   * pixels when one was given, and otherwise the first/last column and row
   * carrying any ink at all -- the drawing's own extent, not the sheet's,
   * since a sheet with wide blank margins would make every real beam look
   * like it spans a smaller fraction than it does.
   *
   * `null` when there is nothing to measure against: no ink anywhere (a blank
   * sheet, or one that failed to load), or a region that encloses no pixel.
   */
  contentBox: { minCol: number; maxCol: number; minRow: number; maxRow: number } | null
  width: number
  height: number
  /** Carried through from the options `inkProfile` was built with, so `linesFromProfile` merges the same way regardless of fraction. */
  mergeWithin: number
}

/**
 * Whether the pixel at `(r, g, b)` belongs to the sheet's red plan-grid
 * overlay or a yellow fill, rather than to a real beam.
 *
 * Both are drawn on the customer's real sheet and both are dark enough in
 * places to pass a naive luminance-only ink test. The red overlay is the
 * admin's own 42-box plan grid -- the coarse grid this whole feature exists
 * to replace with something finer, so detecting it back as "beams" would
 * defeat the point outright. Thresholds are the sheet itself, decoded by hand
 * (see `.superpowers/sdd/phase-3/red-probe.mjs` and `bay-probe.mjs`), not
 * tuned in the abstract.
 */
function isExcludedColor(r: number, g: number, b: number): boolean {
  if (r - g > 40 && r - b > 40) return true // red plan-grid overlay
  if (r > 180 && g > 180 && b < 140) return true // yellow fill
  return false
}

/**
 * Midpoints of every maximal run of `true` in `candidates`, in the same
 * index units as `candidates` itself (not yet normalized).
 *
 * A drawn beam is several pixels wide, so it inks several adjacent candidate
 * columns (or rows) in a row -- collapsing each run to one point BEFORE
 * normalizing is what keeps a real beam from becoming one guide per pixel
 * column and a mesh of zero-width cells. A run's midpoint can land on a
 * half-pixel (an even-width run, e.g. columns 9-10 -> 9.5); that is
 * deliberate, not a rounding slip -- the true centre of a 2px-wide line is
 * between its two pixels.
 */
function runMidpoints(candidates: boolean[]): number[] {
  const mids: number[] = []
  let i = 0
  while (i < candidates.length) {
    if (!candidates[i]) {
      i++
      continue
    }
    let j = i
    while (j < candidates.length && candidates[j]) j++
    mids.push((i + j - 1) / 2)
    i = j
  }
  return mids
}

/**
 * Collapses positions closer together than `within` into their average,
 * scanning ascending. Assumes normalized (0..1) input, since `within` is
 * itself a fraction rather than a pixel count.
 *
 * Run-collapsing (`runMidpoints`) already merges any beam that inks a solid,
 * unbroken stretch of columns. This is the second line of defence for a beam
 * whose ink dips below `inkThreshold` for a pixel or two in the middle --
 * scanning, print noise, a hairline gap at a beam joint -- which would
 * otherwise surface as two separate, near-duplicate guides either side of a
 * gap nobody drew.
 */
function mergeClose(positions: number[], within: number): number[] {
  if (positions.length === 0) return []
  const sorted = [...positions].sort((a, b) => a - b)
  const merged: number[] = [sorted[0]]
  for (let k = 1; k < sorted.length; k++) {
    const last = merged[merged.length - 1]
    if (sorted[k] - last < within) {
      merged[merged.length - 1] = (last + sorted[k]) / 2
    } else {
      merged.push(sorted[k])
    }
  }
  return merged
}

/**
 * The expensive pass: one walk over every pixel, building the per-column and
 * per-row ink counts and the content box. Call this once per drawing (or
 * whenever the drawing itself changes) and cache the result; every
 * sensitivity-slider move afterwards goes through `linesFromProfile` instead.
 *
 * `rgb` is three bytes per pixel, row-major, no alpha (`rgb[(y*width+x)*3]`).
 * A pixel counts as ink when it is dark enough (`isExcludedColor` first
 * rules out the red overlay and yellow fills) -- see `InkOptions.inkThreshold`.
 */
export function inkProfile(
  rgb: Uint8Array,
  width: number,
  height: number,
  options: InkOptions = {},
): InkProfile {
  const inkThreshold = options.inkThreshold ?? DEFAULT_INK_THRESHOLD
  const mergeWithin = options.mergeWithin ?? DEFAULT_MERGE_WITHIN

  const colInk = new Array<number>(Math.max(width, 0)).fill(0)
  const rowInk = new Array<number>(Math.max(height, 0)).fill(0)

  // Half-open in normalized space, inclusive in pixels: a region ending at
  // 0.5 of a 100px image scans up to and including column 49, so two regions
  // meeting at 0.5 never both claim column 50.
  const scanX = options.region
    ? { from: pixelFrom(options.region.x, width), to: pixelTo(options.region.x + options.region.w, width) }
    : { from: 0, to: width - 1 }
  const scanY = options.region
    ? { from: pixelFrom(options.region.y, height), to: pixelTo(options.region.y + options.region.h, height) }
    : { from: 0, to: height - 1 }

  for (let y = scanY.from; y <= scanY.to; y++) {
    const rowOffset = y * width
    for (let x = scanX.from; x <= scanX.to; x++) {
      const o = (rowOffset + x) * 3
      const r = rgb[o]
      const g = rgb[o + 1]
      const b = rgb[o + 2]
      if (isExcludedColor(r, g, b)) continue
      const luminance = r * 0.299 + g * 0.587 + b * 0.114
      if (luminance <= inkThreshold) {
        colInk[x]++
        rowInk[y]++
      }
    }
  }

  return { colInk, rowInk, width, height, mergeWithin, contentBox: contentBox() }

  /**
   * The region when there is one, the ink's own bounding box otherwise, and
   * `null` when neither encloses anything.
   */
  function contentBox(): InkProfile['contentBox'] {
    if (options.region) {
      // A drag too small to enclose a pixel (or one inverted by rounding)
      // gives nothing to divide by, so it is refused rather than clamped up to
      // a one-pixel box that would make every fraction meaningless.
      if (scanX.to < scanX.from || scanY.to < scanY.from) return null
      return { minCol: scanX.from, maxCol: scanX.to, minRow: scanY.from, maxRow: scanY.to }
    }
    let minCol = -1
    let maxCol = -1
    for (let x = 0; x < width; x++) {
      if (colInk[x] > 0) {
        if (minCol === -1) minCol = x
        maxCol = x
      }
    }
    let minRow = -1
    let maxRow = -1
    for (let y = 0; y < height; y++) {
      if (rowInk[y] > 0) {
        if (minRow === -1) minRow = y
        maxRow = y
      }
    }
    // No ink anywhere -- a blank sheet, or one that failed to load. Nothing
    // to divide by and nothing to detect.
    if (minCol === -1 || minRow === -1) return null
    return { minCol, maxCol, minRow, maxRow }
  }
}

/** First pixel index at or after normalized `at`, clamped into the image. */
function pixelFrom(at: number, extent: number): number {
  return Math.min(Math.max(0, Math.round(at * extent)), Math.max(0, extent - 1))
}

/** Last pixel index before normalized `at`, clamped into the image. */
function pixelTo(at: number, extent: number): number {
  return Math.min(Math.max(-1, Math.round(at * extent) - 1), extent - 1)
}

/**
 * The cheap pass: normalized 0..1 positions of the vertical (`x`) and
 * horizontal (`y`) beam lines, read off an already-cached `InkProfile` at a
 * given per-axis sensitivity.
 *
 * `fraction.x` gates which COLUMNS become vertical lines -- a column is a
 * candidate when its ink count is at least `fraction.x` of the content box's
 * height. `fraction.y` gates which ROWS become horizontal lines the same way,
 * against the content box's width. The two are independent on purpose: the
 * customer's real deck under-detects vertical beams at every fraction that
 * finds the horizontal ones cleanly (see the module docblock), so the same
 * number can never be right for both axes, and this is what lets the two
 * sensitivity sliders act on one axis without disturbing the other.
 *
 * Pure and cheap by construction -- no pixels are read here, only the cached
 * counts -- so calling this repeatedly on the same `profile` with a new
 * `fraction` is exactly what a slider drag does, and must never re-derive
 * `profile` itself.
 */
export function linesFromProfile(
  profile: InkProfile,
  fraction: { x: number; y: number },
): { x: number[]; y: number[] } {
  if (!profile.contentBox) return { x: [], y: [] }

  const { minCol, maxCol, minRow, maxRow } = profile.contentBox
  const contentWidth = maxCol - minCol + 1
  const contentHeight = maxRow - minRow + 1

  const colCandidates = profile.colInk.map((count) => count >= fraction.x * contentHeight)
  const rowCandidates = profile.rowInk.map((count) => count >= fraction.y * contentWidth)

  const xPositions = runMidpoints(colCandidates).map((mid) => mid / profile.width)
  const yPositions = runMidpoints(rowCandidates).map((mid) => mid / profile.height)

  return {
    x: mergeClose(xPositions, profile.mergeWithin),
    y: mergeClose(yPositions, profile.mergeWithin),
  }
}
