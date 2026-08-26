import { stageSeqOf } from './progress'
import type { Stage } from './types'

/**
 * The stage a cell advances to next, or null when it is already at the last one.
 *
 * Ordered by `seq` over a COPY, like computeDeckProgress: a screen holds one
 * stages array and hands it to several functions per render, so sorting in place
 * would reorder somebody else's data. `listStages` already returns them sorted,
 * which is exactly why an unsorted caller would go unnoticed without the copy.
 *
 * "The next seq PRESENT", never `seq + 1`. Seq gaps are reachable: saveStages is
 * two round trips, so a removal that renumbers the survivors can commit the
 * delete and lose the renumbering, leaving 1, 2, 4. A `seq + 1` lookup would
 * report "already finished" on a cell sitting at seq 2 of that project.
 *
 * A stageId that is not in `stages` reads as "not started" and yields the first
 * stage, matching stageSeqOf -- a cell can hold a deleted stage's id for as long
 * as it takes the SET NULL cascade to reach it, and the modal must render rather
 * than throw.
 */
export function nextStage(stages: Stage[], stageId: string | null): Stage | null {
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)
  const currentSeq = stageSeqOf(stages, stageId)
  return ordered.find((s) => s.seq > currentSeq) ?? null
}

/**
 * Whether moving a cell from one stage to another walks BACK down the sequence.
 *
 * Drives the red warning in the tap modal. Compared by `seq`, never by array
 * position: index comparison silently inverts on any array not already in seq
 * order, and it cannot express "not started" at all.
 *
 * Returning a recorded cell to not started (`toStageId === null`) is backwards,
 * and deliberately so -- it discards recorded progress, which is the most
 * destructive thing the GS screen can do.
 */
export function isBackwards(
  stages: Stage[],
  fromStageId: string | null,
  toStageId: string | null,
): boolean {
  return stageSeqOf(stages, toStageId) < stageSeqOf(stages, fromStageId)
}

/**
 * Names and colours more than one paint stage is claiming.
 *
 * Both are how a stage is recognised, and by two different people: the admin
 * reads the name in the config and the report, the GS reads the colour off the
 * drawing and nothing else -- the deck is a wall of coloured rectangles and the
 * legend is the only key to it. Two stages sharing either one make a deck that
 * cannot be read back, and no error afterwards would say which of the two a
 * given bay is at.
 *
 * Compared case- and space-insensitively for names, because "Coat 1" and
 * "coat 1 " are the same stage to everyone except a string comparison, and
 * case-insensitively for colours, because #52C41A and #52c41a are one colour.
 */
export function duplicateStageFields(
  stages: { name: string; color: string }[],
): { names: string[]; colors: string[] } {
  const repeated = (values: string[]) => {
    const seen = new Set<string>()
    const twice = new Set<string>()
    for (const value of values) {
      if (seen.has(value)) twice.add(value)
      else seen.add(value)
    }
    return [...twice]
  }
  return {
    names: repeated(stages.map((s) => s.name.trim().toLowerCase())).filter((n) => n !== ''),
    colors: repeated(stages.map((s) => s.color.trim().toLowerCase())),
  }
}
