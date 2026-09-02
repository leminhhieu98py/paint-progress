import { describe, expect, it } from 'vitest'
import { assembleProjectModel } from './workModel'

/** PostgREST-shaped rows: numerics as strings, snake_case. */
const WORKS = [
  { id: 'wB', project_id: 'p1', seq: 2, name: 'Tháo giáo', kind: 'bays', weight: '0.35', counts: true, manual_progress: '0' },
  { id: 'wA', project_id: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: '0.35', counts: true, manual_progress: '0' },
  { id: 'wM', project_id: 'p1', seq: 3, name: 'Marking', kind: 'manual', weight: '0', counts: false, manual_progress: '0.12' },
]
const WORK_DECKS = [
  { work_id: 'wA', deck_id: 'd2', weight: '0.4' },
  { work_id: 'wA', deck_id: 'd1', weight: '0.6' },
  { work_id: 'wB', deck_id: 'd1', weight: '1' },
  { work_id: 'wB', deck_id: 'gone', weight: '0' },
]
const DECKS = [
  {
    id: 'd2', seq: 2, code: 'MD', name: 'Main Deck', total_area_m2: '200', image_path: null, image_w: null, image_h: null, area_source: 'guides',
    cells: [{ id: 'c9', code: 'R1C1', x: '0', y: '0', w: '1', h: '1', area_m2: '200' }],
    deck_stages: [{ id: 'a2', work_id: 'wA', deck_id: 'd2', seq: 1, name: 'Coat 1', color: '#111111', weight: '1' }],
  },
  {
    id: 'd1', seq: 1, code: 'CD', name: 'Cellar Deck', total_area_m2: '100', image_path: 'p1/d1.png', image_w: 2000, image_h: 1600, area_source: 'prorated',
    cells: [
      { id: 'c1', code: 'R1C1', x: '0', y: '0', w: '0.5', h: '1', area_m2: '50' },
      { id: 'c2', code: 'R1C2', x: '0.5', y: '0', w: '0.5', h: '1', area_m2: '50' },
    ],
    deck_stages: [
      { id: 'a1b', work_id: 'wA', deck_id: 'd1', seq: 2, name: 'Coat 2', color: '#222222', weight: '0.5' },
      { id: 'a1a', work_id: 'wA', deck_id: 'd1', seq: 1, name: 'Coat 1', color: '#111111', weight: '0.5' },
      { id: 'b1', work_id: 'wB', deck_id: 'd1', seq: 1, name: 'Tháo giáo lửng', color: '#333333', weight: '1' },
    ],
  },
]
const STATES = [
  { cell_id: 'c1', work_id: 'wA', deck_id: 'd1', stage_id: 'a1b', note: 'ẩm', updated_at: '2026-09-01T00:00:00Z', updated_by: 'u1' },
  { cell_id: 'c1', work_id: 'wB', deck_id: 'd1', stage_id: null, note: '', updated_at: '2026-09-01T00:00:00Z', updated_by: null },
  { cell_id: 'c9', work_id: 'wA', deck_id: 'd2', stage_id: 'a2', note: '', updated_at: '2026-09-01T00:00:00Z', updated_by: 'u1' },
]

const model = () => assembleProjectModel({ works: WORKS, workDecks: WORK_DECKS, decks: DECKS, states: STATES })

describe('assembleProjectModel', () => {
  it('orders works by seq and decks within a work by deck seq', () => {
    const { models } = model()
    expect(models.map((m) => m.work.id)).toEqual(['wA', 'wB', 'wM'])
    expect(models[0].decks.map((d) => d.deck.code)).toEqual(['CD', 'MD'])
  })

  it('projects each bay\'s state for the work it is listed under, and nothing else', () => {
    // The same bay reads Coat 2 under Sơn and not started under Tháo giáo:
    // one position per work is the whole point of 0024.
    const { models } = model()
    const sonCD = models[0].decks[0].deck
    const ggCD = models[1].decks[0].deck
    expect(sonCD.cells.find((c) => c.id === 'c1')).toMatchObject({ stageId: 'a1b', note: 'ẩm', areaM2: 50 })
    expect(ggCD.cells.find((c) => c.id === 'c1')).toMatchObject({ stageId: null, note: '' })
    // A bay with no state row for a work is simply not started.
    expect(sonCD.cells.find((c) => c.id === 'c2')).toMatchObject({ stageId: null, note: '' })
  })

  it('gives each (work, deck) only its own coats, in seq order', () => {
    const { models } = model()
    expect(models[0].decks[0].stages.map((s) => s.id)).toEqual(['a1a', 'a1b'])
    expect(models[1].decks[0].stages.map((s) => s.id)).toEqual(['b1'])
    expect(models[0].decks[0].stages[0].weight).toBe(0.5)
  })

  it('carries the admin\'s deck weight, not the m² share', () => {
    const { models } = model()
    expect(models[0].decks.map((d) => [d.deck.code, d.weight])).toEqual([['CD', 0.6], ['MD', 0.4]])
  })

  it('coerces every numeric and boolean column on the work', () => {
    const { models } = model()
    expect(models[2].work).toEqual({
      id: 'wM', projectId: 'p1', seq: 3, name: 'Marking', kind: 'manual', weight: 0, counts: false, manualProgress: 0.12,
    })
    expect(models[2].decks).toEqual([])
  })

  it('skips a work_decks row whose deck is not in the deck list', () => {
    // RLS can hide a deck, and a stale row can outlive one. Neither should
    // become a deck with no geometry and a weight in the sum.
    const { models } = model()
    expect(models[1].decks.map((d) => d.deck.id)).toEqual(['d1'])
  })

  it('lists every deck once with its drawing fields and bay count, in seq order', () => {
    const { decks } = model()
    expect(decks.map((d) => d.code)).toEqual(['CD', 'MD'])
    expect(decks[0]).toEqual({
      id: 'd1', seq: 1, code: 'CD', name: 'Cellar Deck', totalAreaM2: 100,
      imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600, areaSource: 'prorated', cellCount: 2,
    })
    expect(decks[1].areaSource).toBe('guides')
  })

  it('keeps who last moved each bay, per work, for the report', () => {
    const { audit } = model()
    expect(audit.wA.c1).toEqual({ updatedAt: '2026-09-01T00:00:00Z', updatedBy: 'u1' })
    expect(audit.wB.c1).toEqual({ updatedAt: '2026-09-01T00:00:00Z', updatedBy: null })
  })

  it('assembles nothing from nothing', () => {
    expect(assembleProjectModel({ works: [], workDecks: [], decks: [], states: [] })).toEqual({
      models: [], decks: [], audit: {},
    })
  })
})
