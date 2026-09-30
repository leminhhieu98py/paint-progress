import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Donut, type DonutSlice } from './Donut'

const SLICES: DonutSlice[] = [
  { key: 'cd', label: 'CD', value: 0.2125, color: '#0A8175', detail: 'Tiến độ 50,00% · Đóng góp 21,25%' },
  { key: 'wd', label: 'WD', value: 0.1, color: '#88690B', detail: 'Tiến độ 20,00% · Đóng góp 10,00%' },
  { key: 'td', label: 'TD', value: 0, color: '#2563EB', detail: 'Tiến độ 0,00% · Đóng góp 0,00%' },
]

const slice = (name: string) => screen.getByRole('img', { name })

describe('Donut', () => {
  it('renders the centre content over the ring', () => {
    render(
      <Donut label="Tiến độ dự án" slices={[{ label: 'Main Deck', value: 0.44, color: '#0A8175' }]}>
        <span>44,38%</span>
      </Donut>,
    )
    expect(screen.getByText('44,38%')).toBeInTheDocument()
  })

  it('draws one path per slice with an arc, in the slice colour (CHT-02)', () => {
    render(<Donut label="Tiến độ dự án" slices={SLICES} />)
    const paths = screen.getAllByTestId('donut-slice')
    // TD is at zero: no arc, so no path to hover.
    expect(paths).toHaveLength(2)
    expect(paths.map((p) => p.getAttribute('fill'))).toEqual(['#0A8175', '#88690B'])
    expect(paths[0]).toHaveAttribute('data-arc', '0.2125')
  })

  it('gives the ring an accessible name and each slice its legend figures (CHT-02)', () => {
    render(<Donut label="Tiến độ dự án" slices={SLICES} />)
    expect(screen.getByRole('group', { name: 'Tiến độ dự án' })).toBeInTheDocument()
    expect(slice('CD')).toHaveAccessibleDescription('Tiến độ 50,00% · Đóng góp 21,25%')
    expect(slice('WD')).toHaveAccessibleDescription('Tiến độ 20,00% · Đóng góp 10,00%')
  })

  it('reports the slice under the pointer, and nothing once it leaves (CHT-02)', () => {
    const onActiveChange = vi.fn()
    render(<Donut label="Tiến độ dự án" slices={SLICES} onActiveChange={onActiveChange} />)
    fireEvent.pointerEnter(slice('WD'))
    expect(onActiveChange).toHaveBeenLastCalledWith('wd')
    fireEvent.pointerLeave(slice('WD'))
    expect(onActiveChange).toHaveBeenLastCalledWith(null)
  })

  it('reports a focused slice, and nothing once it blurs (CHT-02)', () => {
    const onActiveChange = vi.fn()
    render(<Donut label="Tiến độ dự án" slices={SLICES} onActiveChange={onActiveChange} />)
    slice('CD').focus()
    expect(onActiveChange).toHaveBeenLastCalledWith('cd')
    slice('CD').blur()
    expect(onActiveChange).toHaveBeenLastCalledWith(null)
  })

  it('keys a slice by its label when it has no key of its own', () => {
    const onActiveChange = vi.fn()
    render(
      <Donut
        label="Tiến độ"
        slices={[{ label: 'Coat 1', value: 0.5, color: '#0A8175' }]}
        onActiveChange={onActiveChange}
      />,
    )
    fireEvent.pointerEnter(slice('Coat 1'))
    expect(onActiveChange).toHaveBeenLastCalledWith('Coat 1')
  })

  it('keeps the active slice full and lifted, and dims the others (CHT-02)', () => {
    const { rerender } = render(<Donut label="Tiến độ dự án" slices={SLICES} activeKey={null} />)
    for (const p of screen.getAllByTestId('donut-slice')) expect(p).toHaveAttribute('opacity', '1')
    const idle = slice('CD').getAttribute('d')

    rerender(<Donut label="Tiến độ dự án" slices={SLICES} activeKey="cd" />)
    expect(slice('CD')).toHaveAttribute('opacity', '1')
    expect(slice('WD')).toHaveAttribute('opacity', '0.35')
    // Lifted: the outer edge moves out (150 / 2 = 75 -> 78), the inner one stays.
    expect(idle).toContain('A75 75')
    expect(slice('CD').getAttribute('d')).toContain('A78 78')
    expect(slice('WD').getAttribute('d')).toContain('A75 75')
  })

  it('shows the slice name and the legend figures in a tooltip while it is hovered (CHT-02)', async () => {
    render(<Donut label="Tiến độ dự án" slices={SLICES} />)
    fireEvent.pointerEnter(slice('CD'))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('CD')
    expect(tip).toHaveTextContent('Tiến độ 50,00% · Đóng góp 21,25%')
  })

  it('puts each line of a several-line detail on a line of its own', async () => {
    render(
      <Donut
        label="Tiến độ"
        slices={[{ label: 'Coat 2', value: 0.5, color: '#bfbfbf', detail: ['Đang ở lớp này: 50,00%', 'Cộng dồn: 100,00%'] }]}
      />,
    )
    expect(slice('Coat 2')).toHaveAccessibleDescription('Đang ở lớp này: 50,00% Cộng dồn: 100,00%')
    fireEvent.pointerEnter(slice('Coat 2'))
    const tip = await screen.findByRole('tooltip')
    expect([...tip.querySelectorAll('div')].map((d) => d.textContent).filter((x) => x?.startsWith('Đang') || x?.startsWith('Cộng')))
      .toEqual(['Đang ở lớp này: 50,00%', 'Cộng dồn: 100,00%'])
  })

  it('gives a slice no wider than its gap no path, so no tab stop and no tooltip (m-2)', () => {
    render(
      <Donut
        label="Tiến độ dự án"
        slices={[...SLICES.slice(0, 2), { key: 'hd', label: 'HD', value: 0.004, color: '#A13A97', detail: 'x' }]}
      />,
    )
    expect(screen.queryByRole('img', { name: 'HD' })).toBeNull()
    expect(screen.getAllByTestId('donut-slice')).toHaveLength(2)
  })

  it('dims nothing when the active key has no visible slice: a 0% row or a sliver (m-7)', () => {
    const slices = [...SLICES, { key: 'hd', label: 'HD', value: 0.004, color: '#A13A97' }]
    const { rerender } = render(<Donut label="Tiến độ dự án" slices={slices} activeKey="td" />)
    for (const p of screen.getAllByTestId('donut-slice')) expect(p).toHaveAttribute('opacity', '1')
    rerender(<Donut label="Tiến độ dự án" slices={slices} activeKey="hd" />)
    for (const p of screen.getAllByTestId('donut-slice')) expect(p).toHaveAttribute('opacity', '1')
  })

  it('still draws the whole remainder track when the slices sum to next to nothing (m-1)', () => {
    render(<Donut label="Tiến độ dự án" slices={[{ label: 'a', value: 1e-7, color: '#0A8175' }]} />)
    const track = screen.getByTestId('donut-remainder')
    // Two half arcs outside, two inside: the full annulus.
    expect(track.getAttribute('d')?.match(/A/g)).toHaveLength(4)
  })

  it('keeps the slice active across the gap to the next one, and lets go only off the ring (m-11)', async () => {
    const onActiveChange = vi.fn()
    render(<Donut label="Tiến độ dự án" slices={SLICES} onActiveChange={onActiveChange} />)
    fireEvent.pointerEnter(slice('CD'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('CD')
    // Onto the white gap after CD: still inside the ring.
    fireEvent.pointerOut(slice('CD'), { relatedTarget: screen.getByTestId('donut-hit') })
    expect(onActiveChange).toHaveBeenLastCalledWith('cd')
    expect(screen.getByRole('tooltip')).toHaveTextContent('CD')
    // Into the next slice: that one, with no none-active frame between.
    fireEvent.pointerOut(screen.getByTestId('donut-hit'), { relatedTarget: slice('WD') })
    expect(onActiveChange.mock.calls.map((c) => c[0])).toEqual(['cd', 'wd'])
    // Off the ring altogether.
    fireEvent.pointerLeave(slice('WD'))
    expect(onActiveChange).toHaveBeenLastCalledWith(null)
  })

  it('lets go when the pointer moves from a slice onto the remainder track', () => {
    const onActiveChange = vi.fn()
    render(<Donut label="Tiến độ dự án" slices={SLICES} onActiveChange={onActiveChange} />)
    fireEvent.pointerEnter(slice('WD'))
    fireEvent.pointerOut(slice('WD'), { relatedTarget: screen.getByTestId('donut-remainder') })
    expect(onActiveChange).toHaveBeenLastCalledWith(null)
  })

  describe('on touch (m-3)', () => {
    const tap = (el: Element) => {
      fireEvent.pointerDown(el, { pointerType: 'touch' })
      fireEvent.pointerUp(el, { pointerType: 'touch' })
      // The browser's own leave after a lifted finger: not the reader leaving.
      fireEvent.pointerLeave(el, { pointerType: 'touch' })
    }

    it('toggles a slice on a tap, keeps it after the finger lifts, and clears it on a second tap', async () => {
      const onActiveChange = vi.fn()
      render(<Donut label="Tiến độ dự án" slices={SLICES} onActiveChange={onActiveChange} />)
      fireEvent.pointerEnter(slice('CD'), { pointerType: 'touch' })
      expect(onActiveChange).not.toHaveBeenCalled()
      tap(slice('CD'))
      expect(onActiveChange.mock.calls.map((c) => c[0])).toEqual(['cd'])
      expect(await screen.findByRole('tooltip')).toHaveTextContent('CD')
      tap(slice('CD'))
      expect(onActiveChange).toHaveBeenLastCalledWith(null)
    })

    it('clears the slice when the next tap lands anywhere else', () => {
      const onActiveChange = vi.fn()
      render(<Donut label="Tiến độ dự án" slices={SLICES} onActiveChange={onActiveChange} />)
      tap(slice('CD'))
      fireEvent.pointerDown(document.body, { pointerType: 'touch' })
      expect(onActiveChange).toHaveBeenLastCalledWith(null)
    })

    it('moves to another slice tapped next', () => {
      const onActiveChange = vi.fn()
      render(<Donut label="Tiến độ dự án" slices={SLICES} onActiveChange={onActiveChange} />)
      tap(slice('CD'))
      tap(slice('WD'))
      expect(onActiveChange).toHaveBeenLastCalledWith('wd')
    })
  })

  it('opens no tooltip when a slice is only made active from outside, by its legend row', () => {
    // The row the reader is pointing at already prints the same figures.
    render(<Donut label="Tiến độ dự án" slices={SLICES} activeKey="cd" />)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
