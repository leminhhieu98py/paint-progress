import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { palette } from '../theme'
import { SectionCard } from './SectionCard'

describe('SectionCard', () => {
  it('shows its title and body', () => {
    render(<SectionCard title="Cấu hình lớp sơn">nội dung</SectionCard>)
    expect(screen.getByRole('heading', { name: 'Cấu hình lớp sơn' })).toBeInTheDocument()
    expect(screen.getByText('nội dung')).toBeInTheDocument()
  })

  it('shows the spec code and the summary beside the title', () => {
    render(
      <SectionCard code="A3.2" title="Cấu hình lớp sơn" summary="5 lớp · tổng 1,00">
        x
      </SectionCard>,
    )
    expect(screen.getByText('A3.2')).toBeInTheDocument()
    expect(screen.getByText('5 lớp · tổng 1,00')).toBeInTheDocument()
  })

  it('marks its body so a stylesheet can inset the tables inside it (LAY-01)', () => {
    // `.pp-card` is the one hook the global stylesheet keys on to give the
    // first and last table column the card's own 20px gutter. Without it every
    // list screen carried its own compensating class or padding.
    render(<SectionCard title="Danh sách">nội dung</SectionCard>)
    expect(screen.getByText('nội dung').closest('.pp-card')).not.toBeNull()
  })

  it('has no toggle at all when it is not collapsible', () => {
    render(<SectionCard title="Cấu hình lớp sơn">x</SectionCard>)
    expect(screen.queryByRole('button', { name: 'Cấu hình lớp sơn' })).not.toBeInTheDocument()
  })

  it('collapses and expands its body, and says which state it is in', async () => {
    const user = userEvent.setup()
    render(
      <SectionCard collapsible title="Cấu hình lớp sơn">
        nội dung
      </SectionCard>,
    )
    const toggle = screen.getByRole('button', { name: 'Cấu hình lớp sơn' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('nội dung')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByText('nội dung')).toBeInTheDocument()
  })

  it('keeps the summary readable while collapsed', async () => {
    // The summary is what a collapsed panel is FOR: four panels shut, and the
    // admin still reads "184 ô đã dựng" and "tổng 1,00" without opening one.
    const user = userEvent.setup()
    render(
      <SectionCard collapsible title="Phân ô" summary="184 ô đã dựng">
        nội dung
      </SectionCard>,
    )
    await user.click(screen.getByRole('button', { name: 'Phân ô' }))
    expect(screen.getByText('184 ô đã dựng')).toBeInTheDocument()
  })

  it('can start collapsed', () => {
    render(
      <SectionCard collapsible defaultOpen={false} title="Phân ô">
        nội dung
      </SectionCard>,
    )
    expect(screen.queryByText('nội dung')).not.toBeInTheDocument()
  })

  it('renders header actions, and keeps them usable while collapsed', async () => {
    const user = userEvent.setup()
    render(
      <SectionCard collapsible title="Phân ô" extra={<button type="button">Lưu</button>}>
        nội dung
      </SectionCard>,
    )
    await user.click(screen.getByRole('button', { name: 'Phân ô' }))
    // Save belongs to the panel, not to its body. Hiding it with the body
    // would make "collapse to see more of the page" cost the admin the
    // action they collapsed the page to get to.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeInTheDocument()
  })

  it('sets code, title and summary on the type scale (TYP-01, TYP-03)', () => {
    render(
      <SectionCard code="A3.2" title="Cấu hình lớp sơn" summary="5 lớp">
        x
      </SectionCard>,
    )
    expect(screen.getByText('A3.2')).toHaveStyle({ fontSize: '11px', fontWeight: '600' })
    expect(screen.getByRole('heading', { name: 'Cấu hình lớp sơn' })).toHaveStyle({
      fontSize: '15px',
      fontWeight: '600',
    })
    expect(screen.getByText('5 lớp')).toHaveStyle({ fontSize: '12px', fontWeight: '400', color: palette.textTertiary })
  })
})

describe('SectionCard: an extra that fills the header', () => {
  it('lets the extra take the header row\'s free width, its items at the right end, when asked', () => {
    render(<SectionCard title="Sàn" extra={<button type="button">Lưu</button>} extraFill>x</SectionCard>)
    const wrapper = screen.getByRole('button', { name: 'Lưu' }).parentElement as HTMLElement
    expect(wrapper).toHaveStyle({ flex: '1 1 auto', minWidth: '0px', justifyContent: 'flex-end' })
  })

  it('keeps the extra its own width otherwise', () => {
    render(<SectionCard title="Sàn" extra={<button type="button">Lưu</button>}>x</SectionCard>)
    const wrapper = screen.getByRole('button', { name: 'Lưu' }).parentElement as HTMLElement
    expect(wrapper.style.flex).toBe('')
    expect(wrapper).toHaveStyle({ marginLeft: 'auto' })
  })
})
