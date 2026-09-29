import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from 'antd'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { space } from '../theme'
import { FilterSheet } from './FilterSheet'

const bar = () => screen.getByRole('search', { name: 'Bộ lọc' })
const sheetButton = () => within(bar()).getByRole('button', { name: 'Bộ lọc' })
const openSheet = async () => {
  await userEvent.click(sheetButton())
  return screen.findByRole('dialog', { name: 'Bộ lọc' })
}
const gone = () => waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bộ lọc' })).toBeNull())
/** The sheet's controls, as the screens hand them over: full width each. */
const controls = (
  <>
    <Select aria-label="Dự án" style={{ width: '100%' }} options={[]} />
    <Select aria-label="Công việc" style={{ width: '100%' }} options={[]} />
  </>
)
type Props = Partial<ComponentProps<typeof FilterSheet>>
const renderSheet = (props: Props = {}) => {
  const handlers = { onApply: vi.fn(), onReset: vi.fn(), onDiscard: vi.fn() }
  const view = render(<FilterSheet count={0} {...handlers} {...props}>{controls}</FilterSheet>)
  return { ...handlers, ...view }
}

describe('FilterSheet: the phone bar is one row (FLT-04)', () => {
  it('holds the inline control and the Bộ lọc button in one row that does not wrap', () => {
    renderSheet({ inline: <Select aria-label="Sàn" options={[]} /> })
    expect(bar()).toHaveStyle({ display: 'flex', flexWrap: 'nowrap' })
    const inline = within(bar()).getByRole('combobox', { name: 'Sàn' })
    // The inline control takes what the button leaves.
    expect(inline.closest('.ant-select')?.parentElement).toHaveStyle({ flex: '1 1 auto', minWidth: '0px' })
    expect(sheetButton().querySelector('.anticon-filter')).not.toBeNull()
    expect(sheetButton()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(sheetButton()).toHaveAttribute('aria-expanded', 'false')
    // The rest of the bar waits in the sheet, not on the page.
    expect(within(bar()).queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a one-line summary of what is applied, which opens the sheet too and says so (M8)', async () => {
    renderSheet({ summary: 'DEMO · Tất cả sàn · Sơn' })
    const summary = within(bar()).getByRole('button', { name: 'DEMO · Tất cả sàn · Sơn' })
    expect(summary).toHaveStyle({ flex: '1 1 auto', minWidth: '0px' })
    expect(within(summary).getByText('DEMO · Tất cả sàn · Sơn')).toHaveStyle({
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    })
    expect(summary).toHaveAttribute('aria-haspopup', 'dialog')
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(summary)
    expect(await screen.findByRole('dialog', { name: 'Bộ lọc' })).toBeInTheDocument()
    expect(summary).toHaveAttribute('aria-expanded', 'true')
  })

  it('badges the button with the number of filters off their defaults, and none at zero', () => {
    const { unmount } = renderSheet({ count: 2 })
    expect(bar().querySelector('.ant-badge-count')).toHaveTextContent('2')
    unmount()
    renderSheet({ count: 0 })
    expect(bar().querySelector('.ant-badge-count')).toBeNull()
  })
})

describe('FilterSheet: the sheet (FLT-04, FLT-09)', () => {
  it('opens from the bottom, titled Bộ lọc, as tall as its controls up to 80% of the screen', async () => {
    renderSheet()
    const dialog = await openSheet()
    expect(sheetButton()).toHaveAttribute('aria-expanded', 'true')
    expect(dialog.closest('.ant-drawer')).toHaveClass('ant-drawer-bottom')
    expect(dialog.closest('.ant-drawer-content-wrapper')).toHaveStyle({ height: 'auto' })
  })

  it('bounds the panel, not only its wrapper: the body scrolls and the footer stays in view (I4)', async () => {
    renderSheet()
    const dialog = await openSheet()
    // The panel itself is capped and stacks header, body and footer as a column...
    const panel = dialog.closest('.ant-drawer-content') as HTMLElement
    expect(panel.getAttribute('style')).toContain('max-height: 80vh')
    expect(panel).toHaveStyle({ display: 'flex', flexDirection: 'column' })
    // ...where the body alone gives way and scrolls, and the footer never shrinks.
    const body = dialog.querySelector('.ant-drawer-body') as HTMLElement
    const footer = dialog.querySelector('.ant-drawer-footer') as HTMLElement
    expect(body).toHaveStyle({ flex: '1 1 auto', minHeight: '0px', overflowY: 'auto' })
    expect(footer).toHaveStyle({ flexShrink: '0' })
    expect(body.parentElement).toBe(footer.parentElement)
  })

  it('stacks every control full width, one gap apart, on the footer\'s inset (M1)', async () => {
    renderSheet()
    const dialog = await openSheet()
    const body = dialog.querySelector('.ant-drawer-body') as HTMLElement
    const footer = dialog.querySelector('.ant-drawer-footer') as HTMLElement
    expect(body).toHaveStyle({ display: 'flex', flexDirection: 'column', gap: `${space.md}px` })
    expect(body).toHaveStyle({ paddingLeft: `${space.xl}px`, paddingRight: `${space.xl}px` })
    expect(footer).toHaveStyle({ paddingLeft: `${space.xl}px`, paddingRight: `${space.xl}px` })
    for (const name of ['Dự án', 'Công việc']) {
      expect(within(dialog).getByRole('combobox', { name }).closest('.ant-select')).toHaveStyle({ width: '100%' })
    }
  })

  it('ends with Đặt lại and Tìm, equal halves of one row, and no Xong (FLT-09)', async () => {
    renderSheet()
    const dialog = await openSheet()
    const footer = dialog.querySelector('.ant-drawer-footer') as HTMLElement
    const buttons = within(footer).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Đặt lại', 'Tìm'])
    expect(buttons[0]).toHaveClass('ant-btn-variant-outlined')
    expect(buttons[1]).toHaveClass('ant-btn-primary')
    expect(buttons[0].parentElement).toHaveStyle({ display: 'flex', gap: `${space.sm}px` })
    for (const b of buttons) expect(b).toHaveStyle({ flex: '1 1 0' })
    expect(within(dialog).queryByRole('button', { name: 'Xong' })).toBeNull()
  })

  it('applies once on Tìm and closes, discarding nothing', async () => {
    const { onApply, onDiscard } = renderSheet()
    const dialog = await openSheet()
    await userEvent.click(within(dialog).getByRole('button', { name: /Tìm/ }))
    expect(onApply).toHaveBeenCalledOnce()
    await gone()
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('resets on Đặt lại, which the screen applies, and stays open', async () => {
    const { onReset, onApply, onDiscard } = renderSheet()
    const dialog = await openSheet()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Đặt lại' }))
    expect(onReset).toHaveBeenCalledOnce()
    expect(onApply).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Bộ lọc' })).toBeInTheDocument()
  })

  it.each([
    ['its close button', async () => {
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Bộ lọc' })).getByRole('button', { name: /Close|Đóng/ }))
    }],
    ['Esc', async () => {
      // From inside the sheet, where a browser puts the focus when it opens;
      // rc-drawer reads the key code.
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Bộ lọc' }), { key: 'Escape', keyCode: 27 })
    }],
    ['a tap on the mask', async () => {
      await userEvent.click(document.querySelector('.ant-drawer-mask') as HTMLElement)
    }],
  ])('discards the draft when closed by %s, and applies nothing', async (_, close) => {
    const { onApply, onDiscard } = renderSheet()
    await openSheet()
    await close()
    await gone()
    expect(onDiscard).toHaveBeenCalledOnce()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('holds Tìm while the draft\'s options load', async () => {
    const { onApply } = renderSheet({ applyLoading: true })
    const dialog = await openSheet()
    const tim = within(dialog).getByRole('button', { name: /Tìm/ })
    expect(tim).toHaveClass('ant-btn-loading')
    await userEvent.click(tim)
    expect(onApply).not.toHaveBeenCalled()
  })
})
