import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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
})
