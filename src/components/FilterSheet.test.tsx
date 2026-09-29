import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { space } from '../theme'
import { FilterSheet } from './FilterSheet'

const bar = () => screen.getByRole('search', { name: 'Bộ lọc' })
const sheetButton = () => within(bar()).getByRole('button', { name: 'Bộ lọc' })
const openSheet = async () => {
  await userEvent.click(sheetButton())
  return screen.findByRole('dialog', { name: 'Bộ lọc' })
}
/** The sheet's controls, as the screens hand them over: full width each. */
const controls = (
  <>
    <Select aria-label="Dự án" style={{ width: '100%' }} options={[]} />
    <Select aria-label="Sàn" style={{ width: '100%' }} options={[]} />
  </>
)

describe('FilterSheet: the phone bar is one row (FLT-04)', () => {
  it('holds the inline control and the Bộ lọc button in one row that does not wrap', () => {
    render(
      <FilterSheet count={0} inline={<Select aria-label="Sàn chính" options={[]} />}>
        {controls}
      </FilterSheet>,
    )
    expect(bar()).toHaveStyle({ display: 'flex', flexWrap: 'nowrap' })
    const inline = within(bar()).getByRole('combobox', { name: 'Sàn chính' })
    // The inline control takes what the button leaves.
    expect(inline.closest('.ant-select')?.parentElement).toHaveStyle({ flex: '1 1 auto', minWidth: '0px' })
    expect(sheetButton().querySelector('.anticon-filter')).not.toBeNull()
    expect(sheetButton()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(sheetButton()).toHaveAttribute('aria-expanded', 'false')
    // The rest of the bar waits in the sheet, not on the page.
    expect(within(bar()).queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a one-line summary of what is applied, which opens the sheet too', async () => {
    render(
      <FilterSheet count={0} summary="DEMO · Tất cả sàn · Sơn" onApply={() => {}} onReset={() => {}}>
        {controls}
      </FilterSheet>,
    )
    const summary = within(bar()).getByRole('button', { name: 'DEMO · Tất cả sàn · Sơn' })
    expect(summary).toHaveStyle({ flex: '1 1 auto', minWidth: '0px' })
    expect(within(summary).getByText('DEMO · Tất cả sàn · Sơn')).toHaveStyle({
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    })
    await userEvent.click(summary)
    expect(await screen.findByRole('dialog', { name: 'Bộ lọc' })).toBeInTheDocument()
  })

  it('badges the button with the number of filters off their defaults, and none at zero', () => {
    const { unmount } = render(<FilterSheet count={2}>{controls}</FilterSheet>)
    expect(bar().querySelector('.ant-badge-count')).toHaveTextContent('2')
    unmount()
    render(<FilterSheet count={0}>{controls}</FilterSheet>)
    expect(bar().querySelector('.ant-badge-count')).toBeNull()
  })
})

describe('FilterSheet: the sheet (FLT-04)', () => {
  it('opens from the bottom, titled Bộ lọc, as tall as its controls up to 80% of the screen', async () => {
    render(<FilterSheet count={0}>{controls}</FilterSheet>)
    const dialog = await openSheet()
    expect(sheetButton()).toHaveAttribute('aria-expanded', 'true')
    expect(dialog.closest('.ant-drawer')).toHaveClass('ant-drawer-bottom')
    const wrapper = dialog.closest('.ant-drawer-content-wrapper') as HTMLElement
    expect(wrapper.getAttribute('style')).toContain('max-height: 80vh')
    expect(wrapper).toHaveStyle({ height: 'auto' })
  })

  it('stacks every control full width, one gap apart', async () => {
    render(<FilterSheet count={0}>{controls}</FilterSheet>)
    const dialog = await openSheet()
    const body = dialog.querySelector('.ant-drawer-body') as HTMLElement
    expect(body).toHaveStyle({ display: 'flex', flexDirection: 'column', gap: `${space.md}px` })
    for (const name of ['Dự án', 'Sàn']) {
      expect(within(dialog).getByRole('combobox', { name }).closest('.ant-select')).toHaveStyle({ width: '100%' })
    }
  })

  it('ends a draft bar\'s sheet with Đặt lại and Tìm, equal halves of one row; Tìm applies once and closes', async () => {
    const onApply = vi.fn()
    const onReset = vi.fn()
    render(<FilterSheet count={0} summary="DEMO" onApply={onApply} onReset={onReset}>{controls}</FilterSheet>)
    const dialog = await openSheet()
    const footer = dialog.querySelector('.ant-drawer-footer') as HTMLElement
    const buttons = within(footer).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Đặt lại', 'Tìm'])
    expect(buttons[0]).toHaveClass('ant-btn-variant-outlined')
    expect(buttons[1]).toHaveClass('ant-btn-primary')
    expect(buttons[0].parentElement).toHaveStyle({ display: 'flex', gap: `${space.sm}px` })
    for (const b of buttons) expect(b).toHaveStyle({ flex: '1 1 0' })

    await userEvent.click(buttons[0])
    expect(onReset).toHaveBeenCalledOnce()
    await userEvent.click(within(footer).getByRole('button', { name: /Tìm/ }))
    expect(onApply).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bộ lọc' })).toBeNull())
  })

  it('holds Tìm while the draft\'s options load', async () => {
    const onApply = vi.fn()
    render(<FilterSheet count={0} summary="DEMO" onApply={onApply} onReset={() => {}} applyLoading>{controls}</FilterSheet>)
    const dialog = await openSheet()
    const tim = within(dialog).getByRole('button', { name: /Tìm/ })
    expect(tim).toHaveClass('ant-btn-loading')
    await userEvent.click(tim)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('closes on Xong where the controls apply at once', async () => {
    render(<FilterSheet count={0}>{controls}</FilterSheet>)
    const dialog = await openSheet()
    expect(within(dialog).queryByRole('button', { name: /Tìm/ })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xong' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bộ lọc' })).toBeNull())
  })
})
