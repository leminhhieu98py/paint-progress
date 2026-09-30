import { describe, expect, it } from 'vitest'
import { ALL, DEFAULT_KPI_FILTERS, coatKey, kpiFilterCount, kpiSummary } from './kpiFilters'

const DECKS = [{ id: 'd1', name: 'Sàn A' }]
const COATS = [{ value: coatKey('Sơn', 'Lớp 1'), label: 'Lớp 1' }]

describe('kpiFilterCount (FLT-04)', () => {
  it('counts a deck and a coat off Tất cả, and a coat the deck does not have as Tất cả', () => {
    expect(kpiFilterCount(DEFAULT_KPI_FILTERS, COATS)).toBe(0)
    expect(kpiFilterCount({ deckId: 'd1', coat: COATS[0].value }, COATS)).toBe(2)
    expect(kpiFilterCount({ deckId: ALL, coat: coatKey('Sơn', 'Lớp 9') }, COATS)).toBe(0)
  })
})

describe('kpiSummary (FLT-04)', () => {
  it('reads project · deck · coat, Tất cả for either left open', () => {
    expect(kpiSummary('DEMO', DEFAULT_KPI_FILTERS, DECKS, COATS)).toBe('DEMO · Tất cả sàn · Tất cả công đoạn')
    expect(kpiSummary('DEMO', { deckId: 'd1', coat: COATS[0].value }, DECKS, COATS)).toBe('DEMO · Sàn A · Lớp 1')
  })

  it('leaves out a project not known yet, and reads a deck it does not have as Tất cả sàn', () => {
    expect(kpiSummary(undefined, { deckId: 'gone', coat: ALL }, DECKS, COATS)).toBe('Tất cả sàn · Tất cả công đoạn')
  })
})
