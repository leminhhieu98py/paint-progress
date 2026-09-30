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

  it('shows the spec code and the facts beside the title, as KeyFacts pills (HLT-01)', () => {
    render(
      <SectionCard code="A3.2" title="Cấu hình lớp sơn" facts={[{ value: 5, label: 'lớp' }, { prefix: 'tổng', value: '1,00' }]}>
        x
      </SectionCard>,
    )
    expect(screen.getByText('A3.2')).toBeInTheDocument()
    expect(screen.getAllByTestId('key-fact').map((p) => p.textContent)).toEqual(['5 lớp', 'tổng 1,00'])
    // Right after the title, on the title's own row.
    const heading = screen.getByRole('heading', { name: 'Cấu hình lớp sơn' })
    expect(heading.nextElementSibling).toBe(screen.getByTestId('key-facts'))
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

  it('keeps the facts readable while collapsed', async () => {
    // The facts are what a collapsed panel is FOR: four panels shut, and the
    // admin still reads "184 ô đã dựng" and "tổng 1,00" without opening one.
    const user = userEvent.setup()
    render(
      <SectionCard collapsible title="Phân ô" facts={[{ value: 184, label: 'ô đã dựng' }]}>
        nội dung
      </SectionCard>,
    )
    await user.click(screen.getByRole('button', { name: 'Phân ô' }))
    expect(screen.getByTestId('key-fact')).toHaveTextContent('184 ô đã dựng')
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

  it('sets code, title and facts on the type scale (TYP-01, TYP-03)', () => {
    render(
      <SectionCard code="A3.2" title="Cấu hình lớp sơn" facts={[{ value: 5, label: 'lớp' }]}>
        x
      </SectionCard>,
    )
    expect(screen.getByText('A3.2')).toHaveStyle({ fontSize: '11px', fontWeight: '600' })
    expect(screen.getByRole('heading', { name: 'Cấu hình lớp sơn' })).toHaveStyle({
      fontSize: '15px',
      fontWeight: '600',
    })
    expect(screen.getByText('5')).toHaveStyle({ fontSize: '13px', fontWeight: '600' })
    expect(screen.getByText('lớp')).toHaveStyle({ fontSize: '12px', fontWeight: '400' })
    expect(screen.getByTestId('key-fact')).toHaveStyle({ color: palette.textSecondary })
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

describe('SectionCard — the collapsible header (COL-01)', () => {
  const card = (props: Partial<Parameters<typeof SectionCard>[0]> = {}) => (
    <SectionCard
      collapsible
      code="A3.2"
      title="Cấu hình lớp sơn"
      facts={[{ value: 2, label: 'lớp' }]}
      extra={<><button type="button">Lưu</button><select aria-label="Công việc"><option>Sơn</option></select></>}
      {...props}
    >
      nội dung
    </SectionCard>
  )

  it('puts the chevron at the right end, so the header starts at the inset like any card', () => {
    render(card())
    const toggle = screen.getByRole('button', { name: 'Cấu hình lớp sơn' })
    const header = toggle.parentElement as HTMLElement
    expect(header.firstElementChild).toHaveTextContent('A3.2')
    expect(header.lastElementChild).toBe(toggle)
  })

  it('points the chevron right when closed and down when open', async () => {
    render(card())
    const toggle = screen.getByRole('button', { name: 'Cấu hình lớp sơn' })
    expect(toggle.querySelector('.anticon-down')).not.toBeNull()
    await userEvent.click(toggle)
    expect(toggle.querySelector('.anticon-right')).not.toBeNull()
    expect(toggle.querySelector('.anticon-down')).toBeNull()
  })

  it('toggles from anywhere on the header row: the title, a blank stretch', async () => {
    render(card())
    const toggle = screen.getByRole('button', { name: 'Cấu hình lớp sơn' })
    await userEvent.click(screen.getByRole('heading', { name: 'Cấu hình lớp sơn' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle.parentElement as HTMLElement)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('leaves the header\'s own controls and facts alone: they do not toggle', async () => {
    render(card())
    const toggle = screen.getByRole('button', { name: 'Cấu hình lớp sơn' })
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Công việc' }))
    await userEvent.click(screen.getByTestId('key-fact'))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('nội dung')).toBeInTheDocument()
  })

  it('is one button for the keyboard: aria-controls the body, Enter and Space toggle', async () => {
    render(card())
    const toggle = screen.getByRole('button', { name: 'Cấu hình lớp sơn' })
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(body).toHaveTextContent('nội dung')
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })
})
