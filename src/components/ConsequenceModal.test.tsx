import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from 'antd'
import { adminTheme, fieldTheme, palette } from '../theme'
import { ConsequenceModal } from './ConsequenceModal'

const base = {
  open: true,
  tag: 'Thao tác phá huỷ',
  title: 'Xoá toàn bộ lưới ô của sàn?',
  onOk: () => {},
  onCancel: () => {},
}

describe('ConsequenceModal', () => {
  it('takes its tone tints from the palette, not from literals (M3)', () => {
    const icon = () => document.querySelector('.ant-modal-body > div > span') as HTMLElement
    const { rerender } = render(<ConsequenceModal {...base} tone="warn" />)
    expect(icon()).toHaveStyle({ background: palette.warningTint })
    rerender(<ConsequenceModal {...base} tone="danger" />)
    expect(icon()).toHaveStyle({ background: palette.errorTint })
  })

  it('keeps the trash can for a delete, and takes a lock, eye or key where nothing is deleted (NL-10)', () => {
    const head = () => document.querySelector('.ant-modal-body > div > span') as HTMLElement
    const { rerender } = render(<ConsequenceModal {...base} tone="danger" />)
    expect(head().querySelector('.anticon-delete')).not.toBeNull()
    for (const [icon, cls] of [['lock', 'lock'], ['hide', 'eye-invisible'], ['key', 'key']] as const) {
      rerender(<ConsequenceModal {...base} tone="danger" icon={icon} />)
      expect(head().querySelector('.anticon-delete')).toBeNull()
      expect(head().querySelector(`.anticon-${cls}`)).not.toBeNull()
      // Still the danger tint: the icon changes, not the weight of the step.
      expect(head()).toHaveStyle({ background: palette.errorTint })
    }
  })

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

  it('states each consequence as its own item, not just the action (RUL-01)', () => {
    // The whole point of this component over Modal.confirm: "are you sure?"
    // tells an admin nothing they did not already know. What the paint crew
    // loses is the decision they are actually making.
    render(
      <ConsequenceModal
        {...base}
        consequences={['Toàn bộ hình học ô phải dựng lại', 'Không khôi phục được']}
      />,
    )
    const list = screen.getByRole('list', { name: 'Hệ quả' })
    expect(within(list).getAllByRole('listitem').map((i) => i.textContent))
      .toEqual(['Toàn bộ hình học ô phải dựng lại', 'Không khôi phục được'])
  })

  it('draws one hairline between who or what it is about and what happens (RUL-01)', () => {
    render(
      <ConsequenceModal
        {...base}
        items={[{ label: 'GS Một', meta: 'gs1' }, { label: 'GS Hai', meta: 'gs2' }]}
        consequences={['Không đăng nhập được nữa']}
      />,
    )
    const list = screen.getByRole('list', { name: 'Hệ quả' })
    expect(list).toHaveStyle({ borderTop: `1px solid ${palette.borderSplit}` })
    // The last subject row draws no line of its own, so the divider is one line.
    const last = screen.getByText('GS Hai').parentElement as HTMLElement
    expect(last.style.borderBottom).toBe('')
    expect((screen.getByText('GS Một').parentElement as HTMLElement).style.borderBottom).not.toBe('')
  })

  it('draws no divider when there is nothing above the consequences', () => {
    render(<ConsequenceModal {...base} consequences={['Không khôi phục được']} />)
    expect(screen.getByRole('list', { name: 'Hệ quả' }).style.borderTop).toBe('')
  })

  it('shows a colour swatch for an item that has one', () => {
    render(<ConsequenceModal {...base} items={[{ label: 'Coat 3', color: '#52c41a' }]} />)
    expect(screen.getByTestId('consequence-swatch')).toHaveStyle({ background: '#52c41a' })
  })

  it.each([
    ['admin', adminTheme, '15px'],
    ['field', fieldTheme, '17px'],
  ] as const)('titles itself as the %s theme titles every other dialog (Q6)', (_n, t, size) => {
    render(<ConfigProvider theme={t}><ConsequenceModal {...base} /></ConfigProvider>)
    expect(screen.getByRole('heading', { level: 3 })).toHaveStyle({ fontSize: size, fontWeight: '600' })
  })

  it('draws the swatch as a plain circle, no inset frame (CLR-01)', () => {
    render(<ConsequenceModal {...base} items={[{ label: 'Coat 3', color: '#52c41a' }]} />)
    const swatch = screen.getByTestId('consequence-swatch')
    expect(swatch).toHaveStyle({ borderRadius: '50%' })
    expect(swatch.style.boxShadow).toBe('')
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

describe('ConsequenceModal — typed confirmation, closed by the parent', () => {
  it('starts empty again however it was closed, not only through Huỷ', async () => {
    // Seen in Chrome: the parent closes this dialog itself after a successful
    // delete, and the next one opened with the previous name still typed.
    // The reset has to hang off `open`, not off which button was pressed.
    const user = userEvent.setup()
    const props = { ...base, tone: 'danger' as const, okText: 'Xóa sàn', confirmText: 'Cellar Deck' }
    const { rerender } = render(<ConsequenceModal {...props} />)
    await user.type(screen.getByLabelText('Gõ đúng tên để xác nhận'), 'Cellar Deck')
    expect(screen.getByRole('button', { name: /Xóa sàn/ })).toBeEnabled()

    rerender(<ConsequenceModal {...props} open={false} />)
    rerender(<ConsequenceModal {...props} open />)

    expect(screen.getByLabelText('Gõ đúng tên để xác nhận')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Xóa sàn/ })).toBeDisabled()
  })
})
