import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { palette } from '../theme'
import { pageSubtitle } from '../test/copy'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('shows the title as the page heading', () => {
    render(<PageHeader title="Dự án" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Dự án' })).toBeInTheDocument()
  })

  it('shows the badge and subtitle when given', () => {
    render(<PageHeader title="Main Deck" badge="MD-01" subtitle="184 ô · 5.258,50 m²" />)
    expect(screen.getByText('MD-01')).toBeInTheDocument()
    expect(screen.getByText('184 ô · 5.258,50 m²')).toBeInTheDocument()
  })

  it('shows the facts right after the title and badge, on the title\'s line, as KeyFacts pills (HLT-01)', () => {
    render(
      <PageHeader
        title="Main Deck"
        badge="MD-01"
        facts={[{ value: 184, label: 'ô' }, { value: '5.258,50', label: 'm²' }]}
      />,
    )
    expect(screen.getAllByTestId('key-fact').map((p) => p.textContent)).toEqual(['184 ô', '5.258,50 m²'])
    const line = screen.getByRole('heading', { level: 1 }).parentElement!
    expect(screen.getByTestId('key-facts').parentElement).toBe(line)
    expect(screen.getByText('MD-01').nextElementSibling).toBe(screen.getByTestId('key-facts'))
    // Wrapping below the title on a narrow header, never overflowing it.
    expect(line).toHaveStyle({ flexWrap: 'wrap' })
  })

  it('has no back button unless a handler is supplied', () => {
    render(<PageHeader title="Dự án" />)
    expect(screen.queryByRole('button', { name: 'Quay lại' })).not.toBeInTheDocument()
  })

  it('calls onBack when the back button is pressed', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<PageHeader title="Main Deck" onBack={onBack} />)
    await user.click(screen.getByRole('button', { name: 'Quay lại' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('renders breadcrumbs as buttons that navigate', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<PageHeader title="Main Deck" breadcrumbs={[{ label: 'Sàn', onClick }]} />)
    await user.click(screen.getByRole('button', { name: 'Sàn' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders the action slot and the filter slot', () => {
    render(
      <PageHeader
        title="Sàn"
        extra={<button type="button">Tạo sàn</button>}
        filters={<label>Dự án</label>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Tạo sàn' })).toBeInTheDocument()
    expect(screen.getByText('Dự án')).toBeInTheDocument()
  })

  it('can hold the subtitle\'s line empty, so a subtitle that arrives with the data grows nothing (R1)', () => {
    const { rerender } = render(<PageHeader title="Nhân viên" reserveSubtitle />)
    const line = pageSubtitle() as HTMLElement
    expect(line).toHaveAttribute('aria-hidden', 'true')
    expect(line.textContent).toBe('\u00a0')
    rerender(<PageHeader title="Nhân viên" reserveSubtitle subtitle="1 đang làm" />)
    expect(pageSubtitle()).toBe(line)
    expect(line).toHaveTextContent('1 đang làm')
    expect(line).not.toHaveAttribute('aria-hidden')
  })

  it('sets title, badge and subtitle on the type scale (TYP-01, TYP-03)', () => {
    render(<PageHeader title="Main Deck" badge="MD-01" subtitle="184 ô" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveStyle({ fontSize: '20px', fontWeight: '600' })
    expect(screen.getByText('MD-01')).toHaveStyle({ fontSize: '11px', fontWeight: '600' })
    expect(screen.getByText('184 ô')).toHaveStyle({
      fontSize: '12px',
      fontWeight: '400',
      color: palette.textTertiary,
    })
  })

  it('puts the title on the same line with or without a subtitle or actions (R3-A, S2)', () => {
    // jsdom has no layout, so this reads what decides the title's y: every
    // box from the heading up to the header, and whatever sits above the
    // heading in each. Those must not change with the subtitle (which a
    // screen may fill in once its data loads) or the actions.
    const chain = (ui: ReactElement) => {
      const { container, unmount } = render(ui)
      const root = container.firstElementChild as HTMLElement
      const boxes: string[] = []
      for (let el: HTMLElement = screen.getByRole('heading', { level: 1 }); el !== root; el = el.parentElement!) {
        const parent = el.parentElement!
        const above = Array.from(parent.children).slice(0, Array.from(parent.children).indexOf(el))
        boxes.push(`${parent.getAttribute('style')} | above: ${above.map((a) => a.tagName).join(',')}`)
      }
      unmount()
      return boxes
    }
    const bare = chain(<PageHeader title="Năng suất" />)
    expect(chain(<PageHeader title="Nhân viên" subtitle="12 người" />)).toEqual(bare)
    expect(chain(<PageHeader title="Người dùng" extra={<button type="button">Tạo</button>} />)).toEqual(bare)
    expect(chain(<PageHeader title="Sàn" facts={[{ value: 184, label: 'ô' }]} />)).toEqual(bare)
    expect(chain(<PageHeader title="Sàn" subtitle="184 ô" extra={<button type="button">Tạo</button>} />)).toEqual(bare)
    // The title's line is a control's height with the title centred in it,
    // and the row aligns its items to the top rather than centring them: a
    // taller column (a subtitle) or 38px actions then move nothing above.
    render(<PageHeader title="Sàn" subtitle="184 ô" extra={<button type="button">Tạo</button>} />)
    const line = screen.getByRole('heading', { level: 1 }).parentElement!
    expect(line).toHaveStyle({ minHeight: '38px', alignItems: 'center' })
    expect(line.parentElement!.parentElement).toHaveStyle({ alignItems: 'flex-start' })
    expect(screen.getByRole('button', { name: 'Tạo' }).parentElement).toHaveStyle({ minHeight: '38px', alignItems: 'center' })
  })
})
