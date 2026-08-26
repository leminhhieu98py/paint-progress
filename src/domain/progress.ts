import type {
  Deck,
  DeckProgress,
  ProjectProgress,
  Stage,
  StageProgress,
  WeightedDeckProgress,
} from './types'

/**
 * Sequence number of a cell's current stage. 0 means not started, which is also
 * the answer for a stage id that no longer exists — a deleted stage should read
 * as "not started" rather than crash a screen.
 */
export function stageSeqOf(stages: Stage[], stageId: string | null): number {
  if (stageId === null) return 0
  return stages.find((s) => s.id === stageId)?.seq ?? 0
}

export function computeDeckProgress(deck: Deck, stages: Stage[]): DeckProgress {
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)
  const total = deck.totalAreaM2

  const stageProgress: StageProgress[] = ordered.map((stage) => {
    // A_i — cumulative by construction: a cell at Coat 3 also counts for Coat 2.
    const cumulativeAreaM2 = deck.cells.reduce(
      (sum, cell) =>
        stageSeqOf(stages, cell.stageId) >= stage.seq ? sum + cell.areaM2 : sum,
      0,
    )
    return {
      stage,
      cumulativeAreaM2,
      ratio: total > 0 ? cumulativeAreaM2 / total : 0,
    }
  })

  const progress = stageProgress.reduce((sum, sp) => sum + sp.stage.weight * sp.ratio, 0)

  return { deckId: deck.id, stages: stageProgress, progress }
}

/**
 * The project's progress, from decks that each carry their own stages.
 *
 * Stages are declared per deck, not per project: a main deck, a cellar deck and
 * a helideck on one job carry different coat systems, and their weights each
 * sum to 1 within their own deck. That is what makes this a weighted average of
 * per-deck percentages rather than one sum over one stage list -- each deck's
 * percentage is already expressed in its own terms before the areas weight it.
 */
export function computeProjectProgress(
  entries: { deck: Deck; stages: Stage[] }[],
): ProjectProgress {
  const totalArea = entries.reduce((sum, e) => sum + e.deck.totalAreaM2, 0)

  const weighted: WeightedDeckProgress[] = entries.map(({ deck, stages }) => ({
    ...computeDeckProgress(deck, stages),
    weight: totalArea > 0 ? deck.totalAreaM2 / totalArea : 0,
  }))

  const progress = weighted.reduce((sum, d) => sum + d.weight * d.progress, 0)

  return { decks: weighted, progress }
}
