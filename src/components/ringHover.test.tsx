import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { palette } from '../theme'
import { LEGEND_ACTIVE_BG, legendRowProps } from './ringHover'

/** Two rows over one active key, as a screen's legend holds them. */
function Legend() {
  const [active, setActive] = useState<string | null>(null)
  return (
    <div>
      <output data-testid="active">{active ?? ''}</output>
      {['a', 'b'].map((k) => (
        <div key={k} data-testid={`row-${k}`} {...legendRowProps(k, active, setActive, { display: 'flex' })}>{k}</div>
      ))}
      <p data-testid="elsewhere">elsewhere</p>
    </div>
  )
}

const active = () => screen.getByTestId('active').textContent
const row = (k: string) => screen.getByTestId(`row-${k}`)
const tap = (el: Element) => {
  fireEvent.pointerDown(el, { pointerType: 'touch' })
  fireEvent.pointerUp(el, { pointerType: 'touch' })
  fireEvent.pointerLeave(el, { pointerType: 'touch' })
}

describe('legendRowProps', () => {
  it('highlights in palette.bgHover and keeps the row where its layout puts it (R5-C1)', () => {
    expect(LEGEND_ACTIVE_BG).toBe(palette.bgHover)
    render(<Legend />)
    fireEvent.pointerEnter(row('a'))
    expect(row('a')).toHaveStyle({ background: palette.bgHover, display: 'flex', margin: '-2px -6px', padding: '2px 6px' })
    expect(row('b').style.background).toBe('')
    expect(row('a')).toHaveAttribute('tabindex', '0')
  })

  it('follows a mouse in and out', () => {
    render(<Legend />)
    fireEvent.pointerEnter(row('a'), { pointerType: 'mouse' })
    expect(active()).toBe('a')
    fireEvent.pointerLeave(row('a'), { pointerType: 'mouse' })
    expect(active()).toBe('')
  })

  it('toggles on a tap and ignores the leave that follows the lifted finger (m-3)', () => {
    render(<Legend />)
    fireEvent.pointerEnter(row('a'), { pointerType: 'touch' })
    expect(active()).toBe('')
    tap(row('a'))
    expect(active()).toBe('a')
    tap(row('a'))
    expect(active()).toBe('')
  })

  it('clears on a tap anywhere else, and moves to another row tapped next (m-3)', () => {
    render(<Legend />)
    tap(row('a'))
    fireEvent.pointerDown(screen.getByTestId('elsewhere'), { pointerType: 'touch' })
    expect(active()).toBe('')
    tap(row('a'))
    tap(row('b'))
    expect(active()).toBe('b')
  })

  it('drops its waiting listener when the row is tapped off, not only on a tap elsewhere (Q4)', () => {
    render(<Legend />)
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    tap(row('a'))
    const listener = add.mock.calls.find(([type]) => type === 'pointerdown')?.[1]
    expect(listener).toBeDefined()
    tap(row('a'))
    expect(active()).toBe('')
    expect(remove).toHaveBeenCalledWith('pointerdown', listener, true)
    add.mockRestore()
    remove.mockRestore()
  })

  it('still clears on a tap elsewhere after a touch on the active row turned into a scroll (CHT-02)', () => {
    render(<Legend />)
    tap(row('a'))
    // A finger that lands on the lit row and scrolls: down, then cancel, no up.
    fireEvent.pointerDown(row('a'), { pointerType: 'touch' })
    fireEvent.pointerCancel(row('a'), { pointerType: 'touch' })
    expect(active()).toBe('a')
    // The next tap lands elsewhere -- on the drawing, say -- and lets go.
    fireEvent.pointerDown(screen.getByTestId('elsewhere'), { pointerType: 'touch' })
    expect(active()).toBe('')
  })
})
