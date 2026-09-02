import { describe, expect, it } from 'vitest'
import { WORKBOOK_STAGES } from './fixtures'
import { duplicateStageFields, isBackwards, nextStage } from './stageFlow'
import type { Stage } from './types'

/** Seq gaps are reachable: saveWorkStages is not transactional, so a failed removal
 *  can leave 1, 2, 4. Nothing in the app renumbers them behind the admin. */
const GAPPED: Stage[] = [
  { id: 'a', seq: 1, name: 'A', color: '#000000', weight: 0.5 },
  { id: 'b', seq: 3, name: 'B', color: '#111111', weight: 0.25 },
  { id: 'c', seq: 7, name: 'C', color: '#222222', weight: 0.25 },
]

describe('nextStage', () => {
  it('returns the first stage for a cell that has not started', () => {
    expect(nextStage(WORKBOOK_STAGES, null)?.id).toBe('coat1')
  })

  it('returns the stage after the current one', () => {
    expect(nextStage(WORKBOOK_STAGES, 'coat3')?.id).toBe('coat4')
  })

  it('returns null at the last stage', () => {
    expect(nextStage(WORKBOOK_STAGES, 'scaffold')).toBeNull()
  })

  it('returns null when the project has no stages', () => {
    expect(nextStage([], null)).toBeNull()
  })

  it('treats a stage id that no longer exists as not started', () => {
    // Matches stageSeqOf: a deleted stage reads as 0, not as a crash. A cell
    // can hold such an id only transiently, but a screen must still render.
    expect(nextStage(WORKBOOK_STAGES, 'deleted-stage')?.id).toBe('coat1')
  })

  it('follows seq order rather than array order', () => {
    // Catches an implementation that walks the array as given. The array here
    // is in reverse seq order, which is exactly what a caller that forgot to
    // sort would hand over.
    const reversed = [...WORKBOOK_STAGES].reverse()
    expect(nextStage(reversed, 'coat2')?.id).toBe('coat3')
  })

  it('steps to the next seq present, not to seq + 1', () => {
    // Catches `stages.find(s => s.seq === current + 1)`, which returns
    // undefined for every gapped project and would report "already finished"
    // on the first coat.
    expect(nextStage(GAPPED, 'a')?.id).toBe('b')
    expect(nextStage(GAPPED, 'b')?.id).toBe('c')
    expect(nextStage(GAPPED, 'c')).toBeNull()
  })

  it('does not reorder the caller\'s array', () => {
    // Catches an in-place `stages.sort(...)`. computeDeckProgress copies before
    // sorting for the same reason; a screen holds one stages array and passes
    // it to several functions per render.
    const reversed = [...WORKBOOK_STAGES].reverse()
    nextStage(reversed, 'coat2')
    expect(reversed.map((s) => s.id)).toEqual(['scaffold', 'coat4', 'coat3', 'coat2', 'coat1'])
  })
})

describe('isBackwards', () => {
  it('is false for the first coat on a cell that has not started', () => {
    expect(isBackwards(WORKBOOK_STAGES, null, 'coat1')).toBe(false)
  })

  it('is false for a forward move', () => {
    expect(isBackwards(WORKBOOK_STAGES, 'coat2', 'coat3')).toBe(false)
  })

  it('is true for a move to an earlier coat', () => {
    expect(isBackwards(WORKBOOK_STAGES, 'coat3', 'coat2')).toBe(true)
  })

  it('is false for re-selecting the same stage', () => {
    expect(isBackwards(WORKBOOK_STAGES, 'coat3', 'coat3')).toBe(false)
  })

  it('is true for returning a recorded cell to not started', () => {
    // The modal offers "Chưa bắt đầu"; wiping a recorded coat is the most
    // destructive move a foreman can make and must carry the red warning.
    expect(isBackwards(WORKBOOK_STAGES, 'coat1', null)).toBe(true)
  })

  it('is false when both ends are not started', () => {
    expect(isBackwards(WORKBOOK_STAGES, null, null)).toBe(false)
  })

  it('compares seq, not array position', () => {
    // Catches `stages.indexOf(to) < stages.indexOf(from)`, which inverts the
    // answer on any array that is not already sorted by seq -- and listWorkStages
    // orders by seq, so such a bug would hide in production and surface only
    // after a reorder.
    const reversed = [...WORKBOOK_STAGES].reverse()
    expect(isBackwards(reversed, 'coat2', 'coat3')).toBe(false)
    expect(isBackwards(reversed, 'coat3', 'coat2')).toBe(true)
  })
})

describe('duplicateStageFields', () => {
  const stage = (name: string, color: string) => ({ name, color })

  it('finds nothing wrong with stages that differ', () => {
    expect(duplicateStageFields([stage('Coat 1', '#1677ff'), stage('Coat 2', '#52c41a')]))
      .toEqual({ names: [], colors: [] })
  })

  it('catches two stages under one name, however it was typed', () => {
    // "Coat 1" and "coat 1 " are the same stage to everyone except a string
    // comparison, and the admin reads the name in the config and the report.
    expect(duplicateStageFields([stage('Coat 1', '#1677ff'), stage('coat 1 ', '#52c41a')]).names)
      .toEqual(['coat 1'])
  })

  it('catches two stages under one colour, however it was written', () => {
    // The GS reads the colour off the drawing and nothing else: the deck is a
    // wall of coloured rectangles and the legend is the only key to it.
    expect(duplicateStageFields([stage('Coat 1', '#52C41A'), stage('Coat 2', '#52c41a')]).colors)
      .toEqual(['#52c41a'])
  })

  it('does not call two unnamed stages a clash', () => {
    // A stage the admin has just added and not named yet is not a duplicate of
    // the next one they add -- it is a row they have not filled in, which the
    // save guard reports in its own words.
    expect(duplicateStageFields([stage('', '#1677ff'), stage('', '#52c41a')]).names).toEqual([])
  })
})
