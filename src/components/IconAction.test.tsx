import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider, theme } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { adminTheme, fieldTheme } from '../theme'
import { ACTION_ICONS } from './actionIcons'
import { IconAction } from './IconAction'

describe('IconAction (ACT-01)', () => {
  it('is an icon-only button named by its label, with the label as its tooltip', async () => {
    const onClick = vi.fn()
    render(<IconAction verb="save" label="Lưu" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Lưu' })
    expect(button).toHaveTextContent('')
    expect(button).toHaveClass('ant-btn-icon-only')
    expect(button.querySelector('.anticon-save')).not.toBeNull()
    await userEvent.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Lưu')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('stands square at the theme\'s one control height, never small or large (CTL-02)', () => {
    for (const t of [adminTheme, fieldTheme]) {
      const { unmount } = render(
        <ConfigProvider theme={t}><IconAction verb="edit" label="Sửa" onClick={() => {}} /></ConfigProvider>,
      )
      const button = screen.getByRole('button', { name: 'Sửa' })
      expect(button).not.toHaveClass('ant-btn-sm')
      expect(button).not.toHaveClass('ant-btn-lg')
      expect(button).toHaveClass('ant-btn-icon-only')
      expect(theme.getDesignToken(t).controlHeight).toBeGreaterThan(0)
      unmount()
    }
  })

  it('keeps a tooltip on a disabled action, saying why when given a reason', async () => {
    render(<IconAction verb="delete" label="Xoá" tooltip="Cần ít nhất một lớp" disabled onClick={() => {}} />)
    const button = screen.getByRole('button', { name: 'Xoá' })
    expect(button).toBeDisabled()
    await userEvent.hover(button.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Cần ít nhất một lớp')
  })

  it('maps each verb to one icon, no icon shared by two verbs', () => {
    const icons = Object.values(ACTION_ICONS)
    expect(new Set(icons).size).toBe(icons.length)
  })
})
