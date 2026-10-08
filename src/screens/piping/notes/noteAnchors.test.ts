import { describe, expect, it } from 'vitest'
import type { PipingNoteEntry } from '../../../lib/pipingApi'
import { anchorKey, groupNotes, spoolNoteCounts } from './noteAnchors'

const note = (id: string, over: Partial<PipingNoteEntry> = {}): PipingNoteEntry => ({
  id, target: 'reinstatement_day', day: '2026-10-01', spoolId: null, body: id, authorId: 'u1',
  createdAt: '2026-10-01T01:00:00Z', updatedBy: null, updatedAt: null, authorName: 'Linh', updatedByName: null,
  ...over,
})

describe('anchorKey', () => {
  it('names a day by its tab and date, a spool by its id', () => {
    expect(anchorKey({ target: 'reinstatement_day', day: '2026-10-01' })).toBe('reinstatement_day|2026-10-01')
    expect(anchorKey({ target: 'manpower_day', day: '2026-10-01' })).toBe('manpower_day|2026-10-01')
    expect(anchorKey({ target: 'spool', spoolId: 's1' })).toBe('spool|s1')
  })
})

describe('groupNotes', () => {
  it('threads the notes per target, newest first, a Reinstatement day apart from the same Manpower day', () => {
    const groups = groupNotes([
      note('old'),
      note('new', { createdAt: '2026-10-02T01:00:00Z' }),
      note('mp', { target: 'manpower_day' }),
      note('sp', { target: 'spool', day: null, spoolId: 's1' }),
    ])
    expect(groups.get('reinstatement_day|2026-10-01')?.map((n) => n.id)).toEqual(['new', 'old'])
    expect(groups.get('manpower_day|2026-10-01')?.map((n) => n.id)).toEqual(['mp'])
    expect(groups.get('spool|s1')?.map((n) => n.id)).toEqual(['sp'])
  })

  it('skips a note without its day or spool', () => {
    expect(groupNotes([note('x', { day: null }), note('y', { target: 'spool', spoolId: null })]).size).toBe(0)
  })
})

describe('spoolNoteCounts', () => {
  it('counts the notes per spool, days left out', () => {
    const counts = spoolNoteCounts([
      note('a', { target: 'spool', day: null, spoolId: 's1' }),
      note('b', { target: 'spool', day: null, spoolId: 's1' }),
      note('c', { target: 'spool', day: null, spoolId: 's2' }),
      note('d'),
    ])
    expect([...counts]).toEqual([['s1', 2], ['s2', 1]])
  })
})
