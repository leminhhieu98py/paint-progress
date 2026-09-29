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

  it('opens no tooltip when a slice is only made active from outside, by its legend row', () => {
    // The row the reader is pointing at already prints the same figures.
    render(<Donut label="Tiến độ dự án" slices={SLICES} activeKey="cd" />)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
