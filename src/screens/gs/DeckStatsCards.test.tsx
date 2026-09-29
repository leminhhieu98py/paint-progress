import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DeckProgressCard, StageRollupCard } from './DeckStatsCards'
import { computeDeckProgress } from '../../domain/progress'
import type { Cell, Stage } from '../../domain/types'
import { palette } from '../../theme'

// Asserting on the ring's SVG would pin geometry, not the shares. The double
// records what the card hands it, and stands in a button per slice for the
// ring's own hover (CHT-02), which the real Donut's tests cover.
vi.mock('../../components/Donut', () => ({
  Donut: ({ slices, children, activeKey, onActiveChange }: {
    slices: { key?: string; label: string; value: number; detail?: string | string[] }[]
    children?: ReactNode
    activeKey?: string | null
    onActiveChange?: (key: string | null) => void
  }) => (
    <div
      data-testid="donut"
      data-slices={JSON.stringify(slices.map((s) => [s.label, s.value]))}
      data-active={activeKey ?? ''}
    >
      {slices.map((s) => (
        <button
          key={s.key ?? s.label}
          type="button"
          data-testid={`slice-${s.key}`}
          data-detail={JSON.stringify(s.detail)}
          onPointerEnter={() => onActiveChange?.(s.key ?? s.label)}
          onPointerLeave={() => onActiveChange?.(null)}
        />
      ))}
      {children}
    </div>
  ),
}))

const STAGES: Stage[] = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.5 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
]

/** Four bays of unequal size, so bay share and area share cannot coincide. */
const CELLS: Cell[] = [
  { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 0.5, areaM2: 700, stageId: 's2' },
  { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 0.5, areaM2: 100, stageId: 's1' },
  { id: 'c3', code: 'R2C1', x: 0, y: 0.5, w: 0.5, h: 0.5, areaM2: 100, stageId: null },
  { id: 'c4', code: 'R2C2', x: 0.5, y: 0.5, w: 0.5, h: 0.5, areaM2: 100, stageId: null },
]

const DECK = { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000, cells: CELLS }

const progressOf = () => computeDeckProgress(DECK, STAGES)

/** A coat row, found by the coat's name. */
const rowOf = (name: string) =>
  screen.getByText(name).closest('[data-testid="gs-stage-row"]') as HTMLElement
/** A coat row's two figures as printed: the area line and the percentage. */
const figuresOf = (name: string) => {
  const row = rowOf(name)
  return {
    area: row.querySelector('[data-testid="gs-stage-area"]')?.textContent,
    percent: row.querySelector('[data-testid="gs-stage-percent"]')?.textContent,
  }
}

const renderRollup = (stages = STAGES, p = progressOf()) =>
  render(
    <StageRollupCard
      stages={stages}
      stageProgress={p.stages}
      cells={CELLS}
      totalAreaM2={DECK.totalAreaM2}
    />,
  )

describe('DeckProgressCard', () => {
  it('prints the one number the foreman is asked for, and what it is out of', () => {
    render(<DeckProgressCard progress={0.4438} totalAreaM2={5258.5} />)
    expect(screen.getByText('44,38%')).toBeInTheDocument()
    expect(screen.getByText('5.258,50 m²')).toBeInTheDocument()
  })

  it('is titled like every admin card, on the field scale (GS-10)', () => {
    render(<DeckProgressCard progress={0.4438} totalAreaM2={5258.5} />)
    const card = screen.getByTestId('gs-deck-progress')
    expect(within(card).getByRole('heading', { level: 2, name: 'Tiến độ sàn' })).toHaveStyle({ fontSize: '15px', fontWeight: '600' })
    expect(within(card).getByText('44,38%')).toHaveStyle({ fontSize: '32px', fontWeight: '700' })
    expect(within(card).getByText('Diện tích sàn')).toHaveStyle({ fontSize: '14px', fontWeight: '400' })
    expect(within(card).getByText('5.258,50 m²')).toHaveStyle({ fontSize: '14px', fontWeight: '600' })
  })

  it('heads a deck in several works with its tổng hợp, then a row per work', () => {
    render(
      <DeckProgressCard
        progress={0.213}
        totalAreaM2={1000}
        perWork={[
          { id: 'w1', name: 'Sơn', progress: 0.155 },
          { id: 'w2', name: 'Tháo giáo', progress: 0.3 },
        ]}
      />,
    )
    const card = screen.getByTestId('gs-deck-progress')
    expect(within(card).getByText('21,30%')).toBeInTheDocument()
    // Round 4: the qualifier explains the figure, so it is the title's (?).
    expect(within(card).queryByText('tổng hợp')).toBeNull()
    const heading = within(card).getByRole('heading', { level: 2 })
    expect(within(heading).getByRole('img', { name: 'Tổng hợp các công việc' })).toBeInTheDocument()
    expect(within(card).getByText('Sơn')).toBeInTheDocument()
    expect(within(card).getByText('15,50%')).toBeInTheDocument()
    expect(within(card).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(card).getByText('30,00%')).toBeInTheDocument()
  })

  it('shows neither caption nor rows for a deck in one work, whose figure IS the work\'s', () => {
    render(
      <DeckProgressCard
        progress={0.4438}
        totalAreaM2={5258.5}
        perWork={[{ id: 'w1', name: 'Sơn', progress: 0.4438 }]}
      />,
    )
    expect(screen.getByText('44,38%')).toBeInTheDocument()
    expect(screen.queryByText('tổng hợp')).toBeNull()
    expect(screen.queryByRole('img', { name: 'Tổng hợp các công việc' })).toBeNull()
    expect(screen.queryByText('Sơn')).toBeNull()
  })
})

describe('StageRollupCard', () => {
  it('reads each coat as m² done over the deck m², cumulatively', () => {
    // A bay at Coat 2 has been through Coat 1: 700 + 100 = 800 m² have reached
    // Coat 1, 700 m² have reached Coat 2. Same denominator as the percent, so
    // the three figures on a row cannot disagree with each other.
    renderRollup()
    expect(figuresOf('Blast + Coat 1')).toEqual({ area: '800,00 / 1.000,00 m²', percent: '80,00%' })
    expect(figuresOf('Coat 2')).toEqual({ area: '700,00 / 1.000,00 m²', percent: '70,00%' })
  })

  it('never wraps the figures: the percent beside the name, the area on its own line', () => {
    // Baseline: "2.880,00 / 2.880,00 m² · 100,00%" wrapped a 325px rail row to three lines.
    renderRollup()
    const row = rowOf('Blast + Coat 1')
    const area = row.querySelector('[data-testid="gs-stage-area"]') as HTMLElement
    const percent = row.querySelector('[data-testid="gs-stage-percent"]') as HTMLElement
    expect(area).toHaveStyle({ whiteSpace: 'nowrap' })
    expect(percent).toHaveStyle({ whiteSpace: 'nowrap', flexShrink: '0' })
    // The name and the percent share the first line.
    expect(within(row).getByText('Blast + Coat 1').parentElement).toBe(percent.parentElement)
  })

  it('lets a long coat name wrap to a second line rather than cut it, the whole name in its title (M-2)', () => {
    const stages = [{ ...STAGES[0], name: 'Blast + Coat 1 (Primer, epoxy zinc-rich)' }, STAGES[1]]
    renderRollup(stages, computeDeckProgress(DECK, stages))
    const name = screen.getByText('Blast + Coat 1 (Primer, epoxy zinc-rich)')
    expect(name.style.whiteSpace).toBe('')
    expect(name.style.textOverflow).toBe('')
    expect(name).toHaveStyle({ WebkitLineClamp: '2' })
    expect(name).toHaveAttribute('title', 'Blast + Coat 1 (Primer, epoxy zinc-rich)')
  })

  it('keeps the figures of a coat with no area standing at it on its row, where the ring has no slice (M-2)', () => {
    // Coat 1's bays have all moved on to Coat 2 here: no slice, but 800 m² went through it.
    const cells = CELLS.map((c) => (c.stageId === 's1' ? { ...c, stageId: 's2' } : c))
    const deck = { ...DECK, cells }
    render(<StageRollupCard stages={STAGES} stageProgress={computeDeckProgress(deck, STAGES).stages} cells={cells} totalAreaM2={1000} />)
    expect(screen.queryByTestId('slice-s1')).toBeNull()
    expect(figuresOf('Blast + Coat 1')).toEqual({ area: '800,00 / 1.000,00 m²', percent: '80,00%' })
  })

  it('marks each coat with a plain circle of its colour, as the admin legends do (CLR-03)', () => {
    renderRollup()
    const marker = rowOf('Coat 2').querySelector('[data-testid="gs-stage-marker"]') as HTMLElement
    expect(marker).toHaveStyle({ width: '11px', height: '11px', borderRadius: '50%', background: '#bfbfbf' })
    expect(marker.style.boxShadow).toBe('')
    expect(marker).toHaveTextContent(/^$/)
  })

  it('is titled like every admin card, the ring\'s centre on the scale (GS-10)', () => {
    renderRollup()
    const card = screen.getByTestId('gs-stage-rollup')
    expect(within(card).getByRole('heading', { level: 2, name: 'Tiến độ theo công đoạn · cộng dồn' }))
      .toHaveStyle({ fontSize: '15px', fontWeight: '600' })
    const donut = screen.getByTestId('donut')
    expect(within(donut).getByText('1.000,00')).toHaveStyle({ fontSize: '21px', fontWeight: '700' })
    expect(within(donut).getByText('m² sàn')).toHaveStyle({ fontSize: '12px' })
    expect(within(card).getByText('Coat 2')).toHaveStyle({ fontSize: '14px', fontWeight: '400' })
  })

  it('names every coat, including one nothing has reached yet', () => {
    const stages = [...STAGES, { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0 }]
    renderRollup(stages, computeDeckProgress(DECK, stages))
    expect(figuresOf('Tháo giáo')).toEqual({ area: '0,00 / 1.000,00 m²', percent: '0,00%' })
  })

  it('shows no bay count anywhere on the card', () => {
    // Feedback Rv1: "không cần hiển thị số ô đã làm / tổng số ô". The office
    // reads m² and percent; a count of bays of unequal size tells it nothing.
    renderRollup()
    const card = screen.getByTestId('gs-stage-rollup')
    expect(within(card).queryByText(/\d+\/\d+ ô/)).toBeNull()
    expect(within(card).queryByText('ô trên sàn')).toBeNull()
  })

  it('puts the deck area in the ring, not a second copy of the deck figure', () => {
    // The deck percentage is already the largest thing on the screen, one card
    // above. The area is what the ring is dividing up.
    renderRollup()
    const donut = screen.getByTestId('donut')
    expect(within(donut).getByText('1.000,00')).toBeInTheDocument()
    expect(within(donut).getByText('m² sàn')).toBeInTheDocument()
    expect(screen.queryByText('75,00%')).toBeNull()
  })

  it('divides the ring by area standing at each coat, not by bay count', () => {
    // One bay of 100 m² sits at Coat 1 and one of 700 at Coat 2. By count they
    // would be equal slices; by area they are 10% and 70% of the deck.
    renderRollup()
    expect(JSON.parse(screen.getByTestId('donut').getAttribute('data-slices') ?? '[]')).toEqual([
      ['Blast + Coat 1', 0.1],
      ['Coat 2', 0.7],
    ])
  })
})

describe('StageRollupCard: the ring and its coat rows (CHT-02)', () => {
  it('makes a hovered or focused coat row\'s slice active, and lets go on leave and blur', () => {
    renderRollup()
    const donut = screen.getByTestId('donut')
    fireEvent.pointerEnter(rowOf('Coat 2'))
    expect(donut).toHaveAttribute('data-active', 's2')
    expect(rowOf('Coat 2')).toHaveStyle({ background: palette.bgHover })
    fireEvent.pointerLeave(rowOf('Coat 2'))
    expect(donut).toHaveAttribute('data-active', '')
    expect(rowOf('Coat 2')).toHaveAttribute('tabindex', '0')
    act(() => rowOf('Blast + Coat 1').focus())
    expect(donut).toHaveAttribute('data-active', 's1')
    act(() => rowOf('Blast + Coat 1').blur())
    expect(donut).toHaveAttribute('data-active', '')
  })

  it('highlights the row of a hovered slice', () => {
    renderRollup()
    fireEvent.pointerEnter(screen.getByTestId('slice-s1'))
    expect(rowOf('Blast + Coat 1')).toHaveStyle({ background: palette.bgHover })
    expect(rowOf('Coat 2').style.background).toBe('')
  })

  it('gives a slice the area standing at its coat and its row\'s figures as printed', () => {
    // 100 m² stand at Blast + Coat 1; 800 m² have been through it.
    renderRollup()
    expect(JSON.parse(screen.getByTestId('slice-s1').getAttribute('data-detail') ?? 'null')).toEqual([
      'Đang ở lớp này: 100,00 / 1.000,00 m² · 10,00%',
      'Cộng dồn: 800,00 / 1.000,00 m² · 80,00%',
    ])
    const { area, percent } = figuresOf('Blast + Coat 1')
    expect(`Cộng dồn: ${area} · ${percent}`).toBe('Cộng dồn: 800,00 / 1.000,00 m² · 80,00%')
  })
})

describe('the work\'s quantity and unit (RV6-35)', () => {
  it('DeckProgressCard names the quantity and the unit of the active work', () => {
    render(<DeckProgressCard progress={0.4438} totalAreaM2={5258.5} quantityLabel="Khối lượng" unit="tấn" />)
    expect(screen.getByText('Khối lượng sàn')).toBeInTheDocument()
    expect(screen.getByText('5.258,50 tấn')).toBeInTheDocument()
    expect(screen.queryByText(/Diện tích/)).toBeNull()
  })

  it('StageRollupCard reads each coat and the ring in the work\'s unit', () => {
    render(
      <StageRollupCard stages={STAGES} stageProgress={progressOf().stages} cells={CELLS} totalAreaM2={DECK.totalAreaM2} unit="tấn" />,
    )
    const card = screen.getByTestId('gs-stage-rollup')
    expect(figuresOf('Blast + Coat 1')).toEqual({ area: '800,00 / 1.000,00 tấn', percent: '80,00%' })
    expect(within(screen.getByTestId('donut')).getByText('tấn sàn')).toBeInTheDocument()
    expect(within(card).queryByText(/m²/)).toBeNull()
  })
})
