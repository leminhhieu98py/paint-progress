import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { palette } from '../theme'
import { StatCard } from './StatCard'

describe('StatCard', () => {
  it('shows label, value and sub-line', () => {
    render(<StatCard label="Tổng diện tích" value="27.482,75" sub="m² trên 4 dự án" />)
    expect(screen.getByText('Tổng diện tích')).toBeInTheDocument()
    expect(screen.getByText('27.482,75')).toBeInTheDocument()
    expect(screen.getByText('m² trên 4 dự án')).toBeInTheDocument()
  })

  it('omits the sub-line rather than leaving an empty row', () => {
    const { container } = render(<StatCard label="Số sàn" value="11" />)
    expect(container.querySelector('[data-testid="stat-sub"]')).toBeNull()
  })

  it('marks the live card so it reads apart from the static three', () => {
    render(<StatCard label="Ghi nhận gần nhất" value="09:42" tone="accent" live />)
    expect(screen.getByTestId('stat-live-dot')).toBeInTheDocument()
  })

  it('has no live dot on an ordinary card', () => {
    render(<StatCard label="Số sàn" value="11" />)
    expect(screen.queryByTestId('stat-live-dot')).not.toBeInTheDocument()
  })

  it('keeps the live dot pulsing, so "live" reads as still-happening', () => {
    // A static orange dot is indistinguishable from a decorative bullet. The
    // admin looks at this card to answer "is anyone on the platform working
    // right now?", and only motion answers that without a second glance.
    render(<StatCard label="Ghi nhận gần nhất" value="09:42" tone="accent" live />)
    expect(screen.getByTestId('stat-live-dot').style.animation).toContain('pp-pulse')
  })

  it('sets the number in display and the lines around it on the scale (TYP-01)', () => {
    render(<StatCard label="Tổng diện tích" value="27.482,75" sub="m²" />)
    expect(screen.getByText('27.482,75')).toHaveStyle({ fontSize: '32px', fontWeight: '700' })
    expect(screen.getByText('Tổng diện tích')).toHaveStyle({ fontSize: '13px', fontWeight: '600' })
    expect(screen.getByText('m²')).toHaveStyle({ fontSize: '12px', fontWeight: '400' })
  })

  it('is compact on a phone: caption label, displaySm figure, micro sub-line, md padding (MOB-02)', () => {
    render(<StatCard label="Tổng diện tích" value="27.482,75" sub="m²" compact />)
    expect(screen.getByText('27.482,75')).toHaveStyle({ fontSize: '21px', fontWeight: '700' })
    expect(screen.getByText('Tổng diện tích')).toHaveStyle({ fontSize: '12px', fontWeight: '400', color: palette.textTertiary })
    expect(screen.getByText('m²')).toHaveStyle({ fontSize: '11px', fontWeight: '600' })
    const card = screen.getByText('Tổng diện tích').closest('[data-testid="stat-card"]') as HTMLElement
    expect(card).toHaveStyle({ padding: '12px' })
  })

  it('keeps the highlighted card\'s tint when compact (MOB-02)', () => {
    render(<StatCard label="Mhr/m² tổng thể" value="1,125" tone="accent" compact />)
    const card = screen.getByText('Mhr/m² tổng thể').closest('[data-testid="stat-card"]') as HTMLElement
    expect(card).toHaveStyle({ background: palette.accentTint })
  })
})
