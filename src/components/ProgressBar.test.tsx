import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
  it('labels the ratio as a percentage in the app-wide format', () => {
    render(<ProgressBar ratio={0.4438} />)
    // Two decimals, comma decimal separator -- the same string lib/format
    // produces everywhere else, so a bar and the table cell beside it can
    // never disagree about the same number.
    expect(screen.getByText('44,38%')).toBeInTheDocument()
  })

  it('fills the track in proportion to the ratio', () => {
    render(<ProgressBar ratio={0.4438} />)
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '44.3800%' })
  })

  it('clamps a ratio above 1 so the fill cannot overflow its track', () => {
    // Reachable: a deck whose stage weights have been edited to sum above 1
    // yields a progress above 1, and a bar wider than its own track escapes
    // the table cell and pushes the column out.
    render(<ProgressBar ratio={1.4} />)
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '100.0000%' })
  })

  it('renders a zero-width fill rather than nothing at zero', () => {
    render(<ProgressBar ratio={0} />)
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '0.0000%' })
    expect(screen.getByText('0,00%')).toBeInTheDocument()
  })

  it('takes a colour so a zone bar can carry its own zone colour', () => {
    render(<ProgressBar ratio={0.5} color="#C2410C" />)
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ background: '#C2410C' })
  })

  it('can hide the label where the number is already shown beside it', () => {
    render(<ProgressBar ratio={0.5} showLabel={false} />)
    expect(screen.queryByText('50,00%')).not.toBeInTheDocument()
  })
})
