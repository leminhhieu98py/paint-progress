import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { palette } from '../theme'
import { StatusPill } from './StatusPill'

describe('StatusPill', () => {
  it('renders its label', () => {
    render(<StatusPill tone="ok">Đã có</StatusPill>)
    expect(screen.getByText('Đã có')).toBeInTheDocument()
  })

  it.each([
    ['ok' as const, palette.successBg],
    ['warn' as const, palette.warningBg],
    ['off' as const, palette.bgHover],
  ])('gives the %s tone its own background', (tone, background) => {
    render(<StatusPill tone={tone}>x</StatusPill>)
    expect(screen.getByText('x')).toHaveStyle({ background })
  })
})
