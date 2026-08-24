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

import type { MeshCell } from './types'

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
 * How much of its own span a column or row must ink to be read as the deck's
 * OUTER beam, independent of the sliders.
 *
 * The boundary is a different question from the interior and needs its own,
 * much lower bar. Measured on the customer's real sheet: at the sliders' 0.60
 * the first and last vertical lines came back 161px and 151px inside the deck's
 * own extent, because the deck's boundary is stepped and its corners are cut,
 * so an outer beam is interrupted where an interior one runs clean. Every bay
 * along the edge then had no closing line and did not exist -- the admin's
 * "ở các biên, các hình chữ nhật thường bị thiếu".
 *
 * 0.20 because the answer is stable across 0.15-0.25 on that sheet (x 886..2200,
 * y 255..2026, which is the deck's real extent to the pixel) and both ends of
 * that range are wrong: 0.30 loses the left beam again, 0.10 reaches out to a
 * dimension line. It is still a threshold over a drawing, so a crop left loose
 * enough to include the title block can pull the bottom bound down onto it --
 * one click with "xoá đường" removes that, and the hint tells the admin to crop
 * close.
 */
const DECK_BOUNDS_FRACTION = 0.2

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
  /**
   * One bit per pixel, set where the pixel is ink, row-major
   * (`bit = y * width + x`). Only pixels inside the region are ever set.
   *
   * The per-column and per-row counts above answer "is there a line here",
   * which is all the sliders need. `keepDrawnCells` asks a different question
   * -- "is THIS cell's edge drawn on the sheet" -- and no pair of 1-D
   * projections can answer it: a column's ink count cannot say WHERE along the
   * column the ink was. Packed to bits rather than bytes because this is React
   * state on a tablet: at the 3000px render width it is 1.1 MB packed against
   * 9.2 MB as a byte per pixel.
   */
  mask: Uint8Array
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
 * How close two lines must be, as a fraction of the median gap between lines on
 * that axis, before they are treated as one beam drawn twice rather than two
 * beams with a bay between them.
 *
 * Measured on the customer's real Main Deck sheet at 3600px: the horizontal bay
 * pitch is 73-86px, and the detector returned four gaps of 11-12px and two of
 * 33-46px. The small ones are not narrow bays -- a beam is drawn with both of
 * its edges, so each beam surfaces as two lines with a sliver of nothing
 * between them, and every one of those slivers becomes a thread-thin cell in
 * the mesh. 0.40 of the median clears the 11-12px pairs and the 46px pair on
 * the vertical axis (median 171px) while leaving the 33px and 42px gaps at the
 * deck's top and bottom edges alone, which is the right call: those could be
 * real narrow bays and the admin can see and delete a line, but cannot recover
 * a bay this rule ate.
 *
 * A fraction of the median, not a pixel count: the same code runs on a sheet
 * rendered at any width and on decks whose bays are any size.
 */
const DOUBLE_LINE_GAP_RATIO = 0.4

/** The middle value, averaging the two middles for an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Replaces each run of lines that sit closer together than
 * `DOUBLE_LINE_GAP_RATIO` of the median gap with a single line at the run's
 * mean -- one beam, at its centre, instead of one line per drawn edge.
 *
 * Clustered rather than merged pairwise: a wide beam can surface as three lines
 * (both edges and its own web), and averaging pairwise walks the result off the
 * beam's centre (100/103/106 becomes 101.5 then 103.75, not 103). The mean of
 * the whole run is the beam's centre.
 *
 * Refuses to act on fewer than three gaps. With two gaps there is no majority
 * to compare against -- either one could itself be the doubled pair -- and
 * guessing there would collapse a two-bay deck into one.
 *
 * One pass, deliberately. A second pass was written first and no test could
 * pin it: collapsing a run raises the median in step with the gaps it widens,
 * so the bar moves with the data and a gap that survived the first pass
 * survives every later one.
 */
function collapseDoubleLines(lines: number[]): number[] {
  if (lines.length < 4) return lines
  const gaps = lines.slice(1).map((pos, i) => pos - lines[i])
  const limit = DOUBLE_LINE_GAP_RATIO * median(gaps)

  const runs: number[][] = [[lines[0]]]
  for (let i = 1; i < lines.length; i++) {
    if (gaps[i - 1] < limit) runs[runs.length - 1].push(lines[i])
    else runs.push([lines[i]])
  }
  return runs.map((run) => run.reduce((sum, pos) => sum + pos, 0) / run.length)
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
  const mask = new Uint8Array(Math.ceil(Math.max(width * height, 0) / 8))

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
        const bit = rowOffset + x
        mask[bit >> 3] |= 1 << (bit & 7)
      }
    }
  }

  return {
    colInk, rowInk, width, height, mergeWithin, mask,
    contentBox: contentBox(),
  }

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

  // The deck's own two edges on each axis, always, whatever the sliders say --
  // see DECK_BOUNDS_FRACTION. Added before the merge below, so a boundary that
  // is also a beam the slider found appears once rather than as a near-duplicate
  // pair.
  const bounds = deckBounds(profile)

  return {
    x: collapseDoubleLines(mergeClose(bounds ? [...xPositions, bounds.x0, bounds.x1] : xPositions, profile.mergeWithin)),
    y: collapseDoubleLines(mergeClose(bounds ? [...yPositions, bounds.y0, bounds.y1] : yPositions, profile.mergeWithin)),
  }
}

/**
 * The deck's own outer edges inside the profile's content box, normalized, as
 * the midpoints of the outermost beams -- not the first and last inked pixel,
 * which would sit on a beam's outer face and make every edge bay a beam-width
 * too big.
 *
 * `null` when there is nothing to measure, or when nothing inks enough of its
 * span to be a beam at all.
 */
function deckBounds(profile: InkProfile): { x0: number; x1: number; y0: number; y1: number } | null {
  if (!profile.contentBox) return null
  const { minCol, maxCol, minRow, maxRow } = profile.contentBox

  /**
   * The midpoints of the first and last runs of `counts` that reach `least`,
   * scanning inward from each end of `from`..`to`.
   */
  const outerRuns = (counts: number[], from: number, to: number, least: number) => {
    let first = -1
    for (let i = from; i <= to; i++) if (counts[i] >= least) { first = i; break }
    if (first === -1) return null
    let last = -1
    for (let i = to; i >= from; i--) if (counts[i] >= least) { last = i; break }
    // The walk is capped at a beam's width. Uncapped, a content box whose every
    // column reaches the bar -- a crop full of dense structure -- is one single
    // run, and its "midpoint" is the middle of the deck: one line through the
    // centre and no boundary at all.
    // Floor of 3, because a drawn line is a few pixels wide at any render size
    // and the fraction alone rounds to zero on a small image.
    const widest = Math.max(3, Math.round(profile.mergeWithin * (to - from + 1)))
    let firstEnd = first
    while (firstEnd + 1 <= to && firstEnd + 1 - first < widest && counts[firstEnd + 1] >= least) firstEnd++
    let lastStart = last
    while (lastStart - 1 >= from && last - (lastStart - 1) < widest && counts[lastStart - 1] >= least) lastStart--
    return [(first + firstEnd) / 2, (lastStart + last) / 2]
  }

  const cols = outerRuns(profile.colInk, minCol, maxCol, DECK_BOUNDS_FRACTION * (maxRow - minRow + 1))
  const rows = outerRuns(profile.rowInk, minRow, maxRow, DECK_BOUNDS_FRACTION * (maxCol - minCol + 1))
  if (!cols || !rows) return null

  return {
    x0: cols[0] / profile.width,
    x1: cols[1] / profile.width,
    y0: rows[0] / profile.height,
    y1: rows[1] / profile.height,
  }
}

/**
 * How far to either side of a cell's edge to look for the beam that edge is
 * meant to sit on, as a fraction of the image's width.
 *
 * A detected line sits at the beam's CENTRE, because a beam is drawn as its two
 * edges and `collapseDoubleLines` replaces that pair with their mean -- so the
 * cell boundary itself lands on the white between the two drawn edges and
 * carries no ink at all. Measured on the customer's real sheet, the doubled
 * pairs were 11-12px apart at 3600px wide, so the drawn edge is ~6px off the
 * centre; 0.004 gives 14px there, which covers that with room for the collapse
 * having moved the line, and stays far short of the 73-86px bay pitch, so an
 * edge can never find its neighbour's beam instead of its own.
 */
const EDGE_INK_BAND_FRACTION = 0.004

/**
 * How much of an edge's length must find ink before that edge counts as drawn.
 * Below 1 on purpose: a beam is interrupted where other structure crosses it,
 * and every bay on a real deck has something crossing at least one side.
 */
const MIN_EDGE_INK = 0.6

/**
 * How many of a cell's four edges must be drawn for the cell to be a bay.
 *
 * Three, not four. A beam that stops part-way leaves the cells either side of
 * it each missing ONE edge, and both of those are real deck the admin still has
 * to paint -- requiring all four would delete deck area on every such beam,
 * which on this sheet is many of them. Two or fewer is a corner rather than a
 * bay: nothing on the sheet says where the other two sides are, which is
 * exactly the case of the areas the admin pointed at and said "those are not
 * rectangles".
 */
const MIN_INKED_EDGES = 3

/**
 * How close two cell boundaries must be, in normalized units, to count as the
 * same boundary. Cell coordinates are sums and differences of guide positions,
 * so two edges that describe the same line can differ by a float ulp.
 */
const TOUCH_TOLERANCE = 1e-9

/**
 * The cells the drawing actually encloses, in the order given.
 *
 * A grid of guides makes a cell for every crossing whether the sheet draws that
 * bay or not, so a mesh over a real deck covers the E-house, the two circular
 * structures, the diagonal brace and the blank corners with cells that are not
 * bays and that nobody will ever paint. This reads the sheet back and keeps the
 * cells whose sides are on it.
 *
 * Generic over the cell type so it can filter a mesh without knowing what else
 * a mesh cell carries; every field is preserved untouched, since this decides
 * membership only and never geometry.
 *
 * A blank sheet needs no special case: no edge finds ink, so nothing is kept.
 */
export function keepDrawnCells<T extends { x: number; y: number; w: number; h: number }>(
  profile: InkProfile,
  cells: T[],
): T[] {
  const drawn = edgeReader(profile)
  return cells.filter((cell) => drawn.sidesOf(cell).filter(Boolean).length >= MIN_INKED_EDGES)
}

/**
 * Reads the sheet back: whether a given edge of a given rectangle is drawn on
 * it. Shared by `keepDrawnCells` and `mergeUndrawnCells` so the two can never
 * disagree about what "drawn" means -- if they could, a cell could be merged
 * across an edge and then dropped for missing that same edge.
 */
function edgeReader(profile: InkProfile) {
  const { width, height, mask } = profile
  const band = Math.max(1, Math.round(EDGE_INK_BAND_FRACTION * width))

  const isInk = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const bit = y * width + x
    return (mask[bit >> 3] & (1 << (bit & 7))) !== 0
  }

  /**
   * The fraction of an axis-aligned edge that finds ink within `band` pixels of
   * itself. `along` walks the edge; the band sweeps the perpendicular.
   */
  const coverage = (fixed: number, from: number, to: number, axis: 'row' | 'column') => {
    const start = Math.round(from)
    const end = Math.round(to)
    if (end < start) return 0
    let inked = 0
    for (let along = start; along <= end; along++) {
      for (let offset = -band; offset <= band; offset++) {
        const found = axis === 'row'
          ? isInk(along, Math.round(fixed) + offset)
          : isInk(Math.round(fixed) + offset, along)
        if (found) {
          inked++
          break
        }
      }
    }
    return inked / (end - start + 1)
  }

  /** Whether a horizontal run at normalized `y`, from `x0` to `x1`, is drawn. */
  const rowDrawn = (y: number, x0: number, x1: number) =>
    coverage(y * height, x0 * width, x1 * width, 'row') >= MIN_EDGE_INK
  /** Whether a vertical run at normalized `x`, from `y0` to `y1`, is drawn. */
  const columnDrawn = (x: number, y0: number, y1: number) =>
    coverage(x * width, y0 * height, y1 * height, 'column') >= MIN_EDGE_INK

  return {
    rowDrawn,
    columnDrawn,
    sidesOf: (cell: { x: number; y: number; w: number; h: number }) => [
      rowDrawn(cell.y, cell.x, cell.x + cell.w),
      rowDrawn(cell.y + cell.h, cell.x, cell.x + cell.w),
      columnDrawn(cell.x, cell.y, cell.y + cell.h),
      columnDrawn(cell.x + cell.w, cell.y, cell.y + cell.h),
    ],
  }
}

/**
 * Merges neighbouring cells of a full grid wherever the beam between them is
 * not drawn on the sheet, so the mesh ends up with the bays the drawing shows:
 * fine where the sheet subdivides, coarse where it does not.
 *
 * This is what a grid alone cannot express. A grid makes every vertical cross
 * every horizontal, so a beam that runs across two bays and stops still cuts
 * the whole deck in half; the admin's own sample of the Main Deck is an uneven
 * tiling -- one wide bay at the top left, a cluster of small ones mid-deck --
 * and that unevenness is the drawing, not their preference.
 *
 * Two passes, in this order, because both must yield rectangles:
 *
 *   1. Along each grid row, merge runs of cells whose shared VERTICAL edge is
 *      absent. Each run is a rectangle by construction.
 *   2. Merge a run with the run directly below it when their left and right
 *      edges line up exactly and the HORIZONTAL edge between them is absent.
 *      The alignment test is what refuses a staircase: cells are `x, y, w, h`
 *      in the database, so a merge that is not a rectangle cannot be stored.
 *
 * `cells` must be a full grid from one `buildMeshFromGuides` call. Areas are
 * summed, which is exact for both measured and prorated meshes, and the merged
 * cell takes the code of its top-left member.
 */
export function mergeUndrawnCells(profile: InkProfile, cells: MeshCell[]): MeshCell[] {
  if (cells.length === 0) return []
  const drawn = edgeReader(profile)

  const rowTops = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b)
  const byRow = rowTops.map((top) =>
    cells.filter((c) => c.y === top).sort((a, b) => a.x - b.x),
  )

  // Pass 1: along each row.
  const runs = byRow.map((row) => {
    const merged: MeshCell[] = []
    for (const cell of row) {
      const open = merged[merged.length - 1]
      // Touching, not merely consecutive. Without this the merge closes a gap
      // where a cell is missing -- and it then makes no difference whether the
      // caller dropped undrawn cells before merging or after, because the
      // merge would swallow the hole either way and claim deck that the
      // drawing does not enclose.
      const touches = open !== undefined && Math.abs(open.x + open.w - cell.x) < TOUCH_TOLERANCE
      if (touches && !drawn.columnDrawn(cell.x, cell.y, cell.y + cell.h)) {
        merged[merged.length - 1] = { ...open, w: cell.x + cell.w - open.x, areaM2: open.areaM2 + cell.areaM2 }
      } else {
        merged.push({ ...cell })
      }
    }
    return merged
  })

  // Pass 2: down the rows. `carried` holds the rectangles still open from the
  // row above; a rectangle stops being open as soon as the row below does not
  // continue it, which is what keeps every result a rectangle.
  const done: MeshCell[] = []
  let carried: MeshCell[] = []
  for (const row of runs) {
    const next: MeshCell[] = []
    for (const run of row) {
      const above = carried.find(
        (c) => c.x === run.x && c.w === run.w && Math.abs(c.y + c.h - run.y) < TOUCH_TOLERANCE,
      )
      if (above && !drawn.rowDrawn(run.y, run.x, run.x + run.w)) {
        next.push({ ...above, h: run.y + run.h - above.y, areaM2: above.areaM2 + run.areaM2 })
      } else {
        next.push({ ...run })
      }
    }
    // Anything the new row did not continue is finished.
    done.push(...carried.filter((c) => !next.some((n) => n.code === c.code)))
    carried = next
  }
  done.push(...carried)

  // Reading order, so the mesh a merge produces is ordered the same way the
  // grid it came from was.
  return done.sort((a, b) => (a.y - b.y) || (a.x - b.x))
}
