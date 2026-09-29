/**
 * The figure in a ring's centre, sized to its hole (I-2, C1).
 *
 * The centre figure (a deck's area, a progress) is set in the largest step of
 * the scale that fits the hole with 4 px either side, down to bodyStrong. It
 * must fit where it sits, not only across the diameter: a caption under it
 * pushes the figure's line off the centre, where the hole is narrower, so the
 * width available is the chord at the figure's outer edge.
 *
 * Widths are estimated, not measured: jsdom has no text layout, and a canvas
 * measure before the web font loads reads the fallback face. The estimate is
 * calibrated to be at least as wide as Chromium draws Be Vietnam Pro (a digit
 * 0.66 em, a separator 0.30 em, `%` 0.92 em), so a figure it passes fits.
 */

type Step = { readonly fontSize: number; readonly fontWeight: number }

/** A ring's hole and what shares the centre with the figure. */
export interface RingGeometry {
  holeDiameter: number
  /** Height of the lines above the figure, margins included (px). */
  above: number
  /** Height of the lines under it, margins included (px). */
  below: number
  /** The figure's letter-spacing, in em. */
  letterSpacingEm: number
}

const CHAR_EM: Record<string, number> = { '.': 0.3, ',': 0.3, '%': 0.92, ' ': 0.28 }
const DEFAULT_EM = 0.66
/** Clear space between the figure and the ring, each side. */
const MARGIN = 4
/** Half a digit's height, from its line's centre (cap height about 0.72 em). */
const HALF_GLYPH_EM = 0.36
/** A 12 px caption line at antd's line height, plus its margin above. */
const CAPTION_LINE = 19

/** The field coat ring (StageRollupCard): 144 px, 22 thick, `m² sàn` under the figure. */
export const GS_RING_SIZE = 144
export const GS_RING_THICKNESS = 22
export const GS_RING: RingGeometry = {
  holeDiameter: GS_RING_SIZE - 2 * GS_RING_THICKNESS,
  above: 0,
  below: CAPTION_LINE + 2,
  letterSpacingEm: -0.028,
}
/** The admin deck ring (DeckProgressPanel): 168 px, 30 thick, a micro label over, the area under. */
export const DECK_RING: RingGeometry = {
  holeDiameter: 168 - 2 * 30,
  above: 17 + 5,
  below: CAPTION_LINE + 3,
  letterSpacingEm: -0.03,
}
/** The project rollup ring (DecksScreen): Donut's default 150 px, 27 thick, `toàn dự án` under. */
export const ROLLUP_RING: RingGeometry = {
  holeDiameter: 150 - 2 * 27,
  above: 0,
  below: CAPTION_LINE + 3,
  letterSpacingEm: -0.028,
}

/** An upper estimate of `text`'s width at `fontSize` px. */
export function textWidthEstimate(text: string, fontSize: number, letterSpacingEm = 0): number {
  let em = 0
  for (const ch of text) em += (CHAR_EM[ch] ?? DEFAULT_EM) + letterSpacingEm
  return em * fontSize
}

/** Whether `text` at `step` fits the hole with the margin either side, at its line's height. */
export function figureFits(text: string, step: Step, ring: RingGeometry): boolean {
  const r = ring.holeDiameter / 2
  const y = Math.abs(ring.above - ring.below) / 2 + HALF_GLYPH_EM * step.fontSize
  if (y >= r) return false
  const chord = 2 * Math.sqrt(r * r - y * y)
  return textWidthEstimate(text, step.fontSize, ring.letterSpacingEm) + 2 * MARGIN <= chord
}

/** The largest of `steps` (largest first) at which `text` fits; the smallest when none does. */
export function ringFigureStep<S extends Step>(text: string, steps: readonly S[], ring: RingGeometry): S {
  return steps.find((s) => figureFits(text, s, ring)) ?? steps[steps.length - 1]
}
