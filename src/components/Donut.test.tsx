import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Donut, conicStops } from './Donut'

describe('conicStops', () => {
  it('lays slices out in order, each followed by a hairline gap', () => {
    const stops = conicStops([
      { label: 'a', value: 0.5, color: '#aa0000' },
      { label: 'b', value: 0.25, color: '#00aa00' },
    ], '#eeeeee')
    // The gap is what keeps two adjacent slices of similar colour from reading
    // as one wedge -- the deck rollup shades three decks of the same hue.
    expect(stops).toBe(
      '#aa0000 0.000% 49.500%,#ffffff 49.500% 50.000%,'
      + '#00aa00 50.000% 74.500%,#ffffff 74.500% 75.000%,'
      + '#eeeeee 75.000% 100%',
    )
  })

  it('skips a zero slice rather than emitting a gap for it', () => {
    // A deck at 0% contributes nothing, and a bare gap where it should be
    // reads as a fourth deck that got lost.
    const stops = conicStops([
      { label: 'a', value: 0.5, color: '#aa0000' },
      { label: 'b', value: 0, color: '#00aa00' },
    ], '#eeeeee')
    expect(stops).not.toContain('#00aa00')
  })

  it('leaves no remainder band when the slices already fill the circle', () => {
    const stops = conicStops([{ label: 'a', value: 1, color: '#aa0000' }], '#eeeeee')
    expect(stops.endsWith('#eeeeee 100.000% 100%')).toBe(true)
  })

  it('renders an all-remainder ring for a project with no progress at all', () => {
    expect(conicStops([], '#eeeeee')).toBe('#eeeeee 0.000% 100%')
  })

  it('never runs a slice past the full circle', () => {
    // Reachable through edited stage weights that sum above 1: an unclamped
    // conic-gradient with stops beyond 100% renders as a solid disc, which
    // reads as a finished deck.
    const stops = conicStops([{ label: 'a', value: 1.4, color: '#aa0000' }], '#eeeeee')
    const percents = [...stops.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]))
    expect(Math.max(...percents)).toBe(100)
  })
})

describe('Donut', () => {
  it('renders the centre content over the ring', () => {
    render(
      <Donut slices={[{ label: 'Main Deck', value: 0.44, color: '#0A8175' }]}>
        <span>44,38%</span>
      </Donut>,
    )
    expect(screen.getByText('44,38%')).toBeInTheDocument()
  })
})
