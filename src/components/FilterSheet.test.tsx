import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from 'antd'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
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
const renderSheet = (props: Props = {}) => render(<FilterSheet count={0} {...props}>{controls}</FilterSheet>)

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

describe('FilterSheet: the sheet (FLT-04, RV7-3)', () => {
  it('opens from the bottom, titled Bộ lọc, as tall as its controls up to 80% of the screen', async () => {
    renderSheet()
    const dialog = await openSheet()
    expect(sheetButton()).toHaveAttribute('aria-expanded', 'true')
    expect(dialog.closest('.ant-drawer')).toHaveClass('ant-drawer-bottom')
    expect(dialog.closest('.ant-drawer-content-wrapper')).toHaveStyle({ height: 'auto' })
  })

  it('bounds the panel, not only its wrapper: the body scrolls (I4)', async () => {
    renderSheet()
    const dialog = await openSheet()
    const panel = dialog.closest('.ant-drawer-content') as HTMLElement
    expect(panel.getAttribute('style')).toContain('max-height: 80vh')
    expect(panel).toHaveStyle({ display: 'flex', flexDirection: 'column' })
    const body = dialog.querySelector('.ant-drawer-body') as HTMLElement
    expect(body).toHaveStyle({ flex: '1 1 auto', minHeight: '0px', overflowY: 'auto' })
  })

  it('stacks every control full width, one gap apart, clear of a home indicator (M1)', async () => {
    renderSheet()
    const dialog = await openSheet()
    const body = dialog.querySelector('.ant-drawer-body') as HTMLElement
    expect(body).toHaveStyle({ display: 'flex', flexDirection: 'column', gap: `${space.md}px` })
    expect(body).toHaveStyle({ paddingLeft: `${space.xl}px`, paddingRight: `${space.xl}px` })
    expect(body.getAttribute('style')).toContain('env(safe-area-inset-bottom')
    for (const name of ['Dự án', 'Công việc']) {
      expect(within(dialog).getByRole('combobox', { name }).closest('.ant-select')).toHaveStyle({ width: '100%' })
    }
  })

  it('has no footer: no Đặt lại, no Tìm, no Xong -- its controls apply as they change (RV7-3)', async () => {
    renderSheet()
    const dialog = await openSheet()
    expect(dialog.querySelector('.ant-drawer-footer')).toBeNull()
    for (const name of ['Đặt lại', 'Tìm', 'Xong']) expect(within(dialog).queryByRole('button', { name })).toBeNull()
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
  ])('closes by %s', async (_, close) => {
    renderSheet()
    await openSheet()
    await close()
    await gone()
    expect(sheetButton()).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('FilterSheet: a second sheet on one screen', () => {
  it('takes its own name for the bar, the button and the sheet, so it reads apart from the page one', async () => {
    renderSheet({ label: 'Lọc spool' })
    const own = screen.getByRole('search', { name: 'Lọc spool' })
    expect(screen.queryByRole('search', { name: 'Bộ lọc' })).toBeNull()
    await userEvent.click(within(own).getByRole('button', { name: 'Lọc spool' }))
    expect(await screen.findByRole('dialog', { name: 'Lọc spool' })).toBeInTheDocument()
  })
})
