import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
