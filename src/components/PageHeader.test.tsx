import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
})
