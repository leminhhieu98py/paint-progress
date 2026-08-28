import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConsequenceModal } from './ConsequenceModal'

const base = {
  open: true,
  tag: 'Thao tác phá huỷ',
  title: 'Xoá toàn bộ lưới ô của sàn?',
  onOk: () => {},
  onCancel: () => {},
}

describe('ConsequenceModal', () => {
  it('names what will be lost, item by item', () => {
    render(
      <ConsequenceModal
        {...base}
        items={[
          { label: '184 ô đã dựng', meta: '5.258,50 m²' },
          { label: '3 zone', meta: 'A · B · C' },
        ]}
      />,
    )
    expect(screen.getByText('184 ô đã dựng')).toBeInTheDocument()
    expect(screen.getByText('5.258,50 m²')).toBeInTheDocument()
    expect(screen.getByText('3 zone')).toBeInTheDocument()
  })

  it('states the consequence, not just the action', () => {
    // The whole point of this component over Modal.confirm: "are you sure?"
    // tells an admin nothing they did not already know. What the paint crew
    // loses is the decision they are actually making.
    render(
      <ConsequenceModal
        {...base}
        consequence="Toàn bộ hình học ô phải dựng lại từ đầu."
      />,
    )
    expect(screen.getByText('Toàn bộ hình học ô phải dựng lại từ đầu.')).toBeInTheDocument()
  })

  it('shows a colour swatch for an item that has one', () => {
    render(<ConsequenceModal {...base} items={[{ label: 'Coat 3', color: '#52c41a' }]} />)
    expect(screen.getByTestId('consequence-swatch')).toHaveStyle({ background: '#52c41a' })
  })

  it('calls onOk from the confirm button and onCancel from the cancel button', async () => {
    const user = userEvent.setup()
    const onOk = vi.fn()
    const onCancel = vi.fn()
    render(<ConsequenceModal {...base} okText="Vẫn xoá" onOk={onOk} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: 'Vẫn xoá' }))
    expect(onOk).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('makes the confirm button dangerous on a destructive action', () => {
    // The only visual difference between "save this" and "destroy this" at a
    // glance. A danger tone whose button looks like every other primary is
    // the failure mode this asserts against.
    const { rerender } = render(<ConsequenceModal {...base} tone="danger" okText="Vẫn xoá" />)
    expect(screen.getByRole('button', { name: /Vẫn xoá/ })).toHaveClass('ant-btn-dangerous')

    rerender(<ConsequenceModal {...base} tone="accent" okText="Lưu" />)
    expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveClass('ant-btn-dangerous')
  })

  it('renders nothing while closed', () => {
    render(<ConsequenceModal {...base} open={false} />)
    expect(screen.queryByText('Xoá toàn bộ lưới ô của sàn?')).not.toBeInTheDocument()
  })
})
