import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from 'antd'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { searchKeyOf, searchSelectProps, useFullOptionsProps } from './searchSelect'
import { setViewport } from '../test/viewport'

const OPTIONS = [
  { value: 'a', label: 'Lê Minh Cường' },
  { value: 'b', label: 'Đặng Văn Bình' },
  { value: 'c', label: 'Nguyễn Thị Cúc' },
]

const combobox = () => screen.getByRole('combobox', { name: 'Người' })

describe('searchSelectProps', () => {
  it('turns typing on and filters on the label', () => {
    expect(searchSelectProps.showSearch).toBe(true)
    expect(searchSelectProps.optionFilterProp).toBe('label')
    expect(searchSelectProps.notFoundContent).toBe('Không có kết quả')
  })

  it('matches without tones: cuong finds Cường, dang finds Đặng', () => {
    const { filterOption } = searchSelectProps
    expect(filterOption('cuong', OPTIONS[0])).toBe(true)
    expect(filterOption('cuong', OPTIONS[1])).toBe(false)
    expect(filterOption('dang', OPTIONS[1])).toBe(true)
    expect(filterOption('DANG', OPTIONS[1])).toBe(true)
    expect(filterOption('', OPTIONS[2])).toBe(true)
  })

  it('searches a ReactNode label through its plain-text search key', () => {
    const rich = { value: 'r', label: <b>Cường</b>, searchKey: 'Lê Minh Cường' }
    expect(searchKeyOf(rich)).toBe('Lê Minh Cường')
    expect(searchSelectProps.filterOption('minh', rich)).toBe(true)
    expect(searchKeyOf({ value: 'n', label: 12 })).toBe('12')
    expect(searchKeyOf(undefined)).toBe('')
  })

  it('narrows the rendered options as the user types', async () => {
    render(<Select aria-label="Người" options={OPTIONS} {...searchSelectProps} />)
    await userEvent.click(combobox())
    expect(await screen.findByTitle('Đặng Văn Bình')).toBeInTheDocument()
    await userEvent.type(combobox(), 'cuong')
    expect(await screen.findByTitle('Lê Minh Cường')).toBeInTheDocument()
    expect(screen.queryByTitle('Đặng Văn Bình')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Nguyễn Thị Cúc')).not.toBeInTheDocument()
  })

  it('says Không có kết quả when nothing matches', async () => {
    render(<Select aria-label="Người" options={OPTIONS} {...searchSelectProps} />)
    await userEvent.click(combobox())
    await userEvent.type(combobox(), 'xyz')
    expect(await screen.findByText('Không có kết quả')).toBeInTheDocument()
  })
})

describe('useFullOptionsProps (options read in full)', () => {
  const LONG = 'Blast + Coat 1 (Primer) Jotun Penguard Primer SEA, a coat whose name runs long'
  let restoreViewport = () => {}
  afterEach(() => restoreViewport())
  function Picker() {
    return <Select aria-label="Lớp" {...useFullOptionsProps()} options={[{ value: 'a', label: LONG }]} />
  }
  const open = async () => {
    render(<Picker />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Lớp' }))
    return document.querySelector('.ant-select-dropdown') as HTMLElement
  }

  it('opens a popup at least as wide as the select, growing to its longest option up to the screen less 16 px a side', async () => {
    restoreViewport = setViewport(1280)
    const popup = await open()
    expect(popup.style.maxWidth).toBe('calc(100vw - 32px)')
    expect(popup.style.left).not.toBe('16px')
  })

  it('on a phone spans the screen less a 16 px gutter each side, wherever its select sits (M3)', async () => {
    restoreViewport = setViewport(390)
    const popup = await open()
    expect(popup.style.left).toBe('16px')
    expect(popup.style.right).toBe('auto')
    expect(popup.style.width).toBe('calc(100vw - 32px)')
    expect(popup.style.maxWidth).toBe('calc(100vw - 32px)')
  })

  it('wraps an option too long for that, never cutting it to an ellipsis', async () => {
    await open()
    const option = await screen.findByTitle(LONG)
    const text = option.querySelector('.ant-select-item-option-content > span') as HTMLElement
    expect(text).toHaveTextContent(LONG)
    expect(text).toHaveStyle({ whiteSpace: 'normal', overflowWrap: 'anywhere' })
  })
})

describe('searchSelectProps reads options in full on its own (M6)', () => {
  const LONG = 'Coat 2 Intermediate epoxy Jotun Penguard HB, a coat whose name runs long'
  it('grows its popup past the select to the longest option, and wraps rather than ellipsising', async () => {
    render(<Select aria-label="Lớp" {...searchSelectProps} style={{ width: 120 }} options={[{ value: 'a', label: LONG }]} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Lớp' }))
    const popup = document.querySelector('.ant-select-dropdown') as HTMLElement
    expect(popup.style.maxWidth).toBe('calc(100vw - 32px)')
    const option = await screen.findByTitle(LONG)
    const text = option.querySelector('.ant-select-item-option-content > span') as HTMLElement
    expect(text).toHaveStyle({ whiteSpace: 'normal', overflowWrap: 'anywhere' })
  })
})

describe('searchSelectProps closes and clears on a choice (A2)', () => {
  const DECKS = [
    { value: 'a', label: 'Main Deck' }, { value: 'b', label: 'Cellar Deck' }, { value: 'c', label: 'Sub Cellar Deck' },
  ]
  function Bar() {
    const [v, setV] = useState('a')
    return (
      <>
        <Select aria-label="Sàn" {...searchSelectProps} value={v} onChange={setV} options={DECKS} />
        <button type="button">Tìm</button>
      </>
    )
  }
  const box = () => screen.getByRole('combobox', { name: 'Sàn' }) as HTMLInputElement
  const shown = () => document.querySelector('.ant-select-selection-item')?.textContent

  it('closes and forgets the typed text when an option is clicked', async () => {
    render(<Bar />)
    await userEvent.click(box())
    await userEvent.type(box(), 'cellar')
    await userEvent.click(screen.getByTitle('Sub Cellar Deck'))
    expect(shown()).toBe('Sub Cellar Deck')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(box().value).toBe('')
  })

  it('closes and forgets the typed text when Enter picks the active option', async () => {
    render(<Bar />)
    await userEvent.click(box())
    await userEvent.type(box(), 'cellar')
    // A real keyboard's Enter carries keyCode 13, which rc-select's option
    // list reads; user-event's synthetic one carries 0 (see the report, A2).
    fireEvent.keyDown(box(), { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
    fireEvent.keyUp(box(), { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
    await waitFor(() => expect(shown()).toBe('Cellar Deck'))
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(box().value).toBe('')
  })

  it('closes and forgets the typed text when the admin moves on to Tìm without choosing', async () => {
    render(<Bar />)
    await userEvent.click(box())
    await userEvent.type(box(), 'cellar')
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }))
    await waitFor(() => expect(box()).toHaveAttribute('aria-expanded', 'false'))
    expect(box().value).toBe('')
    expect(shown()).toBe('Main Deck')
  })
})
