import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Mono } from './Mono'

describe('Mono', () => {
  it('renders its content in the monospace face', () => {
    render(<Mono>R3C7</Mono>)
    // Bay codes are read character by character off a printed drawing. The
    // proportional UI face renders R3C7 and R3C1 close enough to confuse at
    // arm's length; this is the one place the mono face earns its download.
    expect(screen.getByText('R3C7').style.fontFamily).toContain('JetBrains Mono')
  })
})
