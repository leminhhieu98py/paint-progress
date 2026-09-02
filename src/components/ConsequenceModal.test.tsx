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

describe('ConsequenceModal — typed confirmation', () => {
  const typed = {
    ...base,
    tone: 'danger' as const,
    okText: 'Xóa sàn',
    confirmText: 'Cellar Deck',
  }

  it('keeps the confirm disabled until the exact name is typed', async () => {
    // A hard delete of a deck takes its bays, zones, history and notes with
    // it. "Are you sure?" is answered by reflex; typing the name is not.
    const user = userEvent.setup()
    const onOk = vi.fn()
    render(<ConsequenceModal {...typed} onOk={onOk} />)

    const ok = screen.getByRole('button', { name: /Xóa sàn/ })
    expect(ok).toBeDisabled()
    const box = screen.getByLabelText('Gõ đúng tên để xác nhận')
    expect(box).toHaveAttribute('placeholder', 'Cellar Deck')
    await user.type(box, 'Cellar')
    expect(ok).toBeDisabled()
    await user.type(box, ' Deck')
    expect(ok).toBeEnabled()
    await user.click(ok)
    expect(onOk).toHaveBeenCalledOnce()
  })

  it('forgives surrounding spaces but nothing else', async () => {
    const user = userEvent.setup()
    render(<ConsequenceModal {...typed} />)
    const ok = screen.getByRole('button', { name: /Xóa sàn/ })
    const box = screen.getByLabelText('Gõ đúng tên để xác nhận')
    await user.type(box, ' Cellar Deck ')
    expect(ok).toBeEnabled()
    await user.clear(box)
    await user.type(box, 'cellar deck')
    expect(ok).toBeDisabled()
  })

  it('starts empty again after it has been cancelled', async () => {
    // The app-wide rule: a dialog closed by any path comes back clean. A name
    // left typed from last time would make the next delete one click.
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<ConsequenceModal {...typed} onCancel={onCancel} />)
    await user.type(screen.getByLabelText('Gõ đúng tên để xác nhận'), 'Cellar Deck')
    await user.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(onCancel).toHaveBeenCalledOnce()

    rerender(<ConsequenceModal {...typed} onCancel={onCancel} open={false} />)
    rerender(<ConsequenceModal {...typed} onCancel={onCancel} open />)
    expect(screen.getByLabelText('Gõ đúng tên để xác nhận')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Xóa sàn/ })).toBeDisabled()
  })

  it('asks for nothing when no confirmText is given', () => {
    render(<ConsequenceModal {...base} okText="Vẫn xoá" />)
    expect(screen.queryByLabelText('Gõ đúng tên để xác nhận')).toBeNull()
    expect(screen.getByRole('button', { name: 'Vẫn xoá' })).toBeEnabled()
  })
})
