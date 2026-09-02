import type {
  AreaWeightedProjectProgress,
  Deck,
  DeckProgress,
  DeckSummary,
  ProjectProgress,
  Stage,
  StageProgress,
  WeightedDeckProgress,
  WorkModel,
  WorkProgress,
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
 * The rollup before work items: every deck weighted by its share of the
 * project's declared area. Still read by the project list, the deck list and
 * the report until each moves to `computeProjectProgress` over works; the
 * 0024 backfill creates the one-work model that reproduces this exactly (see
 * the equivalence test).
 */
export function areaWeightedProjectProgress(
  entries: { deck: Deck; stages: Stage[] }[],
): AreaWeightedProjectProgress {
  const totalArea = entries.reduce((sum, e) => sum + e.deck.totalAreaM2, 0)

  const weighted: WeightedDeckProgress[] = entries.map(({ deck, stages }) => ({
    ...computeDeckProgress(deck, stages),
    weight: totalArea > 0 ? deck.totalAreaM2 / totalArea : 0,
  }))

  const progress = weighted.reduce((sum, d) => sum + d.weight * d.progress, 0)

  return { decks: weighted, progress }
}

/**
 * One work's progress.
 *
 * A bays work is the weighted average of its decks' own percentages, each deck
 * already expressed in that (work, deck)'s coats; the weights D are the
 * admin's, not the areas' -- Linh's workbook weights Cellar Deck at 0,35 for
 * scaffolding whatever its m² says. A manual work is the percentage she typed.
 */
export function computeWorkProgress(model: WorkModel): WorkProgress {
  if (model.work.kind === 'manual') {
    return { work: model.work, progress: model.work.manualProgress, decks: [] }
  }
  const decks: WeightedDeckProgress[] = model.decks.map((entry) => ({
    ...computeDeckProgress(entry.deck, entry.stages),
    weight: entry.weight,
  }))
  return {
    work: model.work,
    progress: decks.reduce((sum, d) => sum + d.weight * d.progress, 0),
    decks,
  }
}

/**
 * The project's progress: Σ over the works that COUNT of W·P_w.
 *
 * Works that do not count are computed and returned all the same -- Marking,
 * Chứng từ, Lên xà lan are tracked on every screen -- they are simply absent
 * from the sum. This is the number the customer is billed against.
 */
export function computeProjectProgress(models: WorkModel[]): ProjectProgress {
  const works = models.map(computeWorkProgress)
  const progress = works
    .filter((w) => w.work.counts)
    .reduce((sum, w) => sum + w.work.weight * w.progress, 0)
  return { works, progress }
}

/**
 * One deck's "tổng hợp": its per-work percentages averaged by what each
 * (work, deck) weighs in the project total, W·D, over the counted bays works
 * it is part of. A convenience figure for the deck header, the GS tab and the
 * deck list; the report and the rollup carry the real ones.
 *
 * `perWork` lists every work the deck is in, counted or not, so the screens
 * can show the uncounted ones too. A deck in no counted work reads 0 with
 * weight 0 rather than dividing by it.
 */
export function summariseDeck(deckId: string, models: WorkModel[]): DeckSummary {
  const perWork: DeckSummary['perWork'] = []
  let weighted = 0
  let effectiveWeight = 0
  for (const model of models) {
    if (model.work.kind !== 'bays') continue
    const entry = model.decks.find((d) => d.deck.id === deckId)
    if (!entry) continue
    const progress = computeDeckProgress(entry.deck, entry.stages).progress
    perWork.push({ work: model.work, weight: entry.weight, progress })
    if (!model.work.counts) continue
    const share = model.work.weight * entry.weight
    weighted += share * progress
    effectiveWeight += share
  }
  return {
    deckId,
    progress: effectiveWeight > 0 ? weighted / effectiveWeight : 0,
    effectiveWeight,
    perWork,
  }
}
