import { offsetsFromSpans, spansFromOffsets } from './geometry'

/**
 * Pasting the printed mm chain instead of double-clicking and dragging every
 * guide by hand. See `.superpowers/sdd/phase-3/dimension-chain-brief.md` for
 * the full rationale; the short version is in `parseDimensionChain` below.
 */

export type ChainParse =
  | { ok: true; spansMm: number[] }
  | { ok: false; badToken: string }

/** `14.500` or `14,500` -- three-digit groups behind a separator, stripped. */
const THOUSANDS_GROUPED = /^\d{1,3}([.,]\d{3})+$/
/** `2500,5` or `2500.5` -- exactly the separator becomes a decimal point. */
const DECIMAL = /^\d+[.,]\d{1,2}$/
/** `2500` -- no separator at all. */
const PLAIN_INTEGER = /^\d+$/

/**
 * Parse a pasted dimension chain into millimetre spans.
 *
 * Vietnamese writes `14.500` for fourteen and a half thousand; English writes
 * `14,500` for the same number; and `14,5` in Vietnamese is fourteen point
 * five. Guessing wrong on one separator puts the deck out by a factor of a
 * thousand, and nothing downstream catches it -- the divergence banner only
 * fires past 5%, and a 1000x error does not look like a near miss, it looks
 * like a different deck. So every token is matched against exactly the three
 * shapes below, in order, and anything that matches none of them -- rather
 * than being guessed at -- rejects the WHOLE paste, naming that token. A
 * rejected paste costs the admin a retype; a silently misread one costs the
 * project's numbers.
 */
export function parseDimensionChain(text: string): ChainParse {
  const tokens = text
    .split(/[\s;]+/)
    .filter((token) => token !== '' && token !== ',' && token !== '.')

  // No tokens at all -- an empty paste, or one that was only whitespace and
  // separators -- has no valid spans to report, so there is nothing to name.
  if (tokens.length === 0) return { ok: false, badToken: '' }

  const spansMm: number[] = []
  for (const token of tokens) {
    let mm: number
    if (THOUSANDS_GROUPED.test(token)) {
      mm = Number(token.replace(/[.,]/g, ''))
    } else if (DECIMAL.test(token)) {
      mm = Number(token.replace(',', '.'))
    } else if (PLAIN_INTEGER.test(token)) {
      mm = Number(token)
    } else {
      return { ok: false, badToken: token }
    }
    // A zero or negative span is not a bay the admin meant to draw, whatever
    // shape the token itself was valid.
    if (mm <= 0) return { ok: false, badToken: token }
    spansMm.push(mm)
  }

  return { ok: true, spansMm }
}

/**
 * Guide offsets and normalized positions for a chain, mapped between the two
 * ends of the deck on that axis. n spans produce n+1 guides.
 *
 * `offsetMm` reuses `offsetsFromSpans` from a zero datum -- spansMm[0] here is
 * a real span (unlike offsetsFromSpans' own convention where index 0 is an
 * ignored placeholder), so a leading 0 is prepended before handing the array
 * over. `pos` maps each offset onto [startPos, endPos] by its ratio of the
 * chain's total: `startPos + (offsetMm / total) * (endPos - startPos)`. That
 * mapping is the whole feature -- once the two edges are placed, every
 * interior guide's position follows from the mm chain instead of being
 * dragged into place by eye.
 */
export function distributeChain(
  spansMm: number[],
  startPos: number,
  endPos: number,
): { offsetMm: number; pos: number }[] {
  const offsetsMm = offsetsFromSpans(0, [0, ...spansMm])
  const total = offsetsMm[offsetsMm.length - 1]
  // Dividing by a zero total would put every guide on top of the first.
  if (total === 0) {
    throw new Error('Dimension chain has zero total length')
  }
  return offsetsMm.map((offsetMm) => ({
    offsetMm,
    pos: startPos + (offsetMm / total) * (endPos - startPos),
  }))
}

/**
 * After an edge guide on `axis` has been dragged (and already clamped by
 * `moveGuideClamped`), recomputes every INTERIOR guide's `pos` from its
 * existing `offsetMm`, mapped between the two current edges via
 * `distributeChain`. This is what makes four drags enough to re-shape a whole
 * mesh: move one edge, and the guides between it and the other edge follow
 * the mm chain instead of needing to be dragged one at a time.
 *
 * `offsetMm` is never touched -- dragging repositions the drawing overlay and
 * must never edit the dimension the admin typed.
 *
 * Two guards, both returning `guides` unchanged (today's behaviour: only the
 * dragged guide moved):
 *
 *   - `movedIndex` is not the first or last guide on `axis` in `pos` order.
 *     Re-railing is only for edge drags; an interior drag is governed
 *     entirely by `moveGuideClamped`'s own neighbour clamp.
 *   - The axis's mm chain is degenerate (every `offsetMm` equal, typically
 *     all 0 -- guides added by double-click before any span was typed).
 *     There is no chain to scale by.
 *
 * A third guard defends the recompute itself: if the two edges are not in
 * `startPos < endPos` order, this refuses rather than divide by a collapsed
 * or negative range. `moveGuideClamped`'s own neighbour clamp should make
 * that unreachable through the UI -- an edge can never cross its immediate
 * neighbour, and by transitivity never the far edge either -- but this does
 * not trust that proof from the caller's side of the boundary; smearing
 * every interior guide across a reversed range is exactly the class of
 * silent, plausible-looking corruption this whole feature exists to prevent.
 */
export function rerailAxisGuides<T extends { axis: 'x' | 'y'; pos: number; offsetMm: number }>(
  guides: T[],
  axis: 'x' | 'y',
  movedIndex: number,
): T[] {
  const sorted = guides
    .map((guide, index) => ({ guide, index }))
    .filter((entry) => entry.guide.axis === axis)
    .sort((a, b) => a.guide.pos - b.guide.pos)

  // Fewer than 3 guides on this axis means no interior guide exists to
  // re-rail, edge or not.
  if (sorted.length < 3) return guides

  const at = sorted.findIndex((entry) => entry.index === movedIndex)
  if (at !== 0 && at !== sorted.length - 1) return guides

  const first = sorted[0].guide
  const last = sorted[sorted.length - 1].guide
  if (last.offsetMm - first.offsetMm === 0) return guides
  if (!(first.pos < last.pos)) return guides

  const spansMm = spansFromOffsets(sorted.map((entry) => entry.guide.offsetMm)).slice(1)
  let distributed: { offsetMm: number; pos: number }[]
  try {
    distributed = distributeChain(spansMm, first.pos, last.pos)
  } catch {
    // Guarded above already, but a thrown zero-total here must still fall
    // back to "unchanged" rather than propagate out of a state updater.
    return guides
  }

  const posByIndex = new Map(sorted.map((entry, i) => [entry.index, distributed[i].pos]))
  return guides.map((guide, index) =>
    posByIndex.has(index) ? { ...guide, pos: posByIndex.get(index)! } : guide,
  )
}
