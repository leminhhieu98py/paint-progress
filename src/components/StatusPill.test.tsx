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
    ['accent' as const, palette.accentTint],
    ['slate' as const, palette.track],
    ['danger' as const, palette.errorBg],
  ])('gives the %s tone its own background', (tone, background) => {
    render(<StatusPill tone={tone}>x</StatusPill>)
    expect(screen.getByText('x')).toHaveStyle({ background })
  })

  it('is micro text, 11/600 (TYP-01)', () => {
    render(<StatusPill tone="ok">x</StatusPill>)
    expect(screen.getByText('x')).toHaveStyle({ fontSize: '11px', fontWeight: '600' })
  })
})
