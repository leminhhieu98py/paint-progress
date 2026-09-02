import { computeDeckProgress, areaWeightedProjectProgress } from './progress'
import type { Cell, Deck, Stage } from './types'

/**
 * A deck's cells painted to a given depth, without painting anything.
 *
 * The admin wanted to see what the percentages do before a single bay has been
 * ticked on site -- "if the first coat is half done and the primer is finished,
 * what does the report say?" -- and the only way to find out was to tick bays
 * on a real deck, which writes progress somebody then has to unpick.
 *
 * `mix` says what fraction of the deck's AREA reaches each stage, keyed by the
 * stage's name. Area, not cell count, because that is what every percentage in
 * this app is computed from: forty small bays and four large ones are not the
 * same half of a deck.
 *
 * Cells are taken in the order the deck holds them, which is the order they
 * were detected -- top-left to bottom-right. Nothing here is random: the same
 * mix must give the same answer twice, or it cannot be used to check a number.
 */
export function paintDeck(deck: Deck, stages: Stage[], mix: Record<string, number>): Deck {
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)
  const total = deck.cells.reduce((sum, c) => sum + c.areaM2, 0)

  // Deepest first: a bay that reaches Coat 3 has also had Coat 1 and 2, so the
  // shares are read as "this much reaches AT LEAST here" and the deepest claim
  // on a bay is the one that sticks.
  const wanted = [...ordered]
    .reverse()
    .map((stage) => ({ stage, area: (mix[stage.name] ?? 0) * total }))

  const painted: Cell[] = deck.cells.map((cell) => ({ ...cell, stageId: null }))
  let at = 0
  // `covered` runs across the whole loop, not per stage: the shares are read as
  // "at least this far", so asking for half the deck primed and a fifth of it
  // finished means half is painted, not seven tenths.
  let covered = 0
  for (const { stage, area } of wanted) {
    while (at < painted.length && covered < area) {
      painted[at] = { ...painted[at], stageId: stage.id }
      covered += painted[at].areaM2
      at += 1
    }
  }
  return { ...deck, cells: painted }
}

/** One line per stage, plus the deck's weighted total, rounded for reading. */
export function progressReport(deck: Deck, stages: Stage[]): Record<string, string> {
  const computed = computeDeckProgress(deck, stages)
  const lines: Record<string, string> = {}
  for (const sp of computed.stages) {
    lines[sp.stage.name] = `${(sp.ratio * 100).toFixed(1)}% (${sp.cumulativeAreaM2.toFixed(1)} m²)`
  }
  lines['TỔNG'] = `${(computed.progress * 100).toFixed(1)}%`
  return lines
}

/** The same, across a project's decks, weighted by area the way the rollup is. */
export function projectReport(entries: { deck: Deck; stages: Stage[] }[]): Record<string, string> {
  const computed = areaWeightedProjectProgress(entries)
  const lines: Record<string, string> = {}
  for (const deck of computed.decks) {
    lines[deck.deckId] = `${(deck.progress * 100).toFixed(1)}% × ${(deck.weight * 100).toFixed(1)}%`
  }
  lines['TỔNG DỰ ÁN'] = `${(computed.progress * 100).toFixed(1)}%`
  return lines
}
