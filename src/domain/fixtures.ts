import type { Cell, Deck, Stage } from './types'

/** The stage list and weights the source workbook uses. */
export const WORKBOOK_STAGES: Stage[] = [
  { id: 'coat1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 'coat2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
  { id: 'coat4', seq: 4, name: 'Coat 4', color: '#1677ff', weight: 0.15 },
  { id: 'scaffold', seq: 5, name: 'Tháo giáo', color: '#722ed1', weight: 0.1 },
]

/**
 * Builds a deck whose cells reproduce a given set of cumulative stage areas.
 *
 * The workbook records A_i — area at or past stage i — but a deck stores one
 * current stage per cell. Inverting is a difference of adjacent cumulatives:
 * the area sitting exactly at stage i is A_i − A_{i+1}, and whatever is left
 * over from totalAreaM2 has not started.
 */
export function deckFromCumulative(
  code: string,
  name: string,
  totalAreaM2: number,
  cumulative: number[],
  stages: Stage[],
): Deck {
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)
  const cells: Cell[] = []

  if (cumulative.length !== ordered.length) {
    throw new Error(
      `cumulative must have one entry per stage: got ${cumulative.length}, expected ${ordered.length}`,
    )
  }

  const push = (stageId: string | null, areaM2: number) => {
    if (areaM2 <= 0) return
    cells.push({
      id: `${code}-${stageId ?? 'none'}`,
      code: `${code}-${stageId ?? 'none'}`,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      areaM2,
      stageId,
    })
  }

  ordered.forEach((stage, i) => {
    const next = i + 1 < cumulative.length ? cumulative[i + 1] : 0
    if (cumulative[i] < next) {
      throw new Error(
        `cumulative areas must be non-increasing: stage ${stage.seq} has ${cumulative[i]} but stage ${stage.seq + 1} has ${next}`,
      )
    }
    push(stage.id, cumulative[i] - next)
  })
  push(null, totalAreaM2 - (cumulative[0] ?? 0))

  return { id: code, code, name, totalAreaM2, cells }
}

/**
 * The five decks of BB1 - CPPTS with the figures from the `Dashboard` sheet of
 * `THEO DÕI CÔNG VIỆC CPP-TS.xlsx`. Cumulative areas are, in order:
 * Blast+Coat 1, Coat 2, Coat 3, Coat 4, Tháo giáo.
 */
export const WORKBOOK_DECKS: Deck[] = [
  deckFromCumulative('SCD', 'Sub Cellar Deck', 1653.4, [189.4, 189.4, 69.4, 69.4, 0], WORKBOOK_STAGES),
  deckFromCumulative('CD', 'Cellar Deck', 6139, [5571, 5511, 2922.5, 2922.5, 0], WORKBOOK_STAGES),
  deckFromCumulative('MEZZ', 'Mezzanine Deck', 4720.3, [4720.3, 4720.3, 954.3625, 954.3625, 0], WORKBOOK_STAGES),
  deckFromCumulative('MD', 'Main Deck', 5258.5, [5258.5, 5258.5, 842.35, 810.35, 0], WORKBOOK_STAGES),
  deckFromCumulative('WD', 'Weather Deck', 2207, [2207, 2207, 245, 245, 0], WORKBOOK_STAGES),
]
