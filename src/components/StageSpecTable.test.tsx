import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { computeDeckProgress } from '../domain/progress'
import { WORKBOOK_DECKS, WORKBOOK_STAGES } from '../domain/fixtures'
import { StageSpecTable } from './StageSpecTable'

/**
 * The Cellar Deck exactly as the customer's Dashboard sheet records it: 6139 m²
 * declared, cumulative 5571 / 5511 / 2922.5 / 2922.5 / 0. Its computed progress
 * is 0.599552044306890, matching sheet N to 1e-9 (spec §3.3). Using the golden
 * fixture rather than round numbers means the strings below are the ones the
 * customer will actually read.
 */
const CELLAR = WORKBOOK_DECKS.find((d) => d.code === 'CD')!
const progress = computeDeckProgress(CELLAR, WORKBOOK_STAGES)

describe('StageSpecTable', () => {
  it('has one column per stage, in seq order', () => {
    render(<StageSpecTable stages={progress.stages} />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      '', 'Blast + Coat 1', 'Coat 2', 'Coat 3', 'Coat 4', 'Tháo giáo',
    ])
  })

  it('shows the cumulative area per stage', () => {
    render(<StageSpecTable stages={progress.stages} />)
    const row = screen.getByRole('row', { name: /^m²/ })
    // A_i: cumulative by construction, so a cell at Coat 3 also counts toward
    // Coat 2 and Blast + Coat 1. These are the workbook's own numbers, in
    // vi-VN format.
    expect(within(row).getByText('5.571,00')).toBeInTheDocument()
    expect(within(row).getByText('5.511,00')).toBeInTheDocument()
    expect(within(row).getAllByText('2.922,50')).toHaveLength(2)
    expect(within(row).getByText('0,00')).toBeInTheDocument()
  })

  it('shows each stage\'s share of the whole deck', () => {
    render(<StageSpecTable stages={progress.stages} />)
    const row = screen.getByRole('row', { name: /^% Total Deck/ })
    // p_i = A_i / 6139, the deck's declared area. 5571/6139 = 90,75%, not the
    // 100% a denominator of Σ cell.area_m2 would give for the first coat.
    expect(within(row).getByText('90,75%')).toBeInTheDocument()
    expect(within(row).getByText('89,77%')).toBeInTheDocument()
    expect(within(row).getAllByText('47,61%')).toHaveLength(2)
    expect(within(row).getByText('0,00%')).toBeInTheDocument()
  })

  it('keeps the workbook\'s own row labels', () => {
    render(<StageSpecTable stages={progress.stages} />)
    expect(screen.getByText('m²')).toBeInTheDocument()
    expect(screen.getByText('% Total Deck')).toBeInTheDocument()
  })

  it('renders exactly two data rows', () => {
    render(<StageSpecTable stages={progress.stages} />)
    // One header row plus two. Catches a paginated or virtualised table that
    // silently drops the second row on a short viewport.
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('renders nothing but a header when the project has no stages', () => {
    render(<StageSpecTable stages={[]} />)
    expect(screen.queryByText('m²')).toBeNull()
  })
})
