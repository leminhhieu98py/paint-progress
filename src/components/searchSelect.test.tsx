import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from 'antd'
import { describe, expect, it } from 'vitest'
import { fullOptionsProps, searchKeyOf, searchSelectProps } from './searchSelect'

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

describe('fullOptionsProps (options read in full)', () => {
  const LONG = 'Blast + Coat 1 (Primer) Jotun Penguard Primer SEA, a coat whose name runs long'

  it('opens a popup at least as wide as the select, growing to its longest option up to the screen less 16 px a side', async () => {
    expect(fullOptionsProps.popupMatchSelectWidth).toBe(false)
    render(<Select aria-label="Lớp" {...fullOptionsProps} options={[{ value: 'a', label: LONG }]} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Lớp' }))
    const popup = document.querySelector('.ant-select-dropdown') as HTMLElement
    expect(popup.style.maxWidth).toBe('calc(100vw - 32px)')
  })

  it('wraps an option too long for that, never cutting it to an ellipsis', async () => {
    render(<Select aria-label="Lớp" {...fullOptionsProps} options={[{ value: 'a', label: LONG }]} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Lớp' }))
    const option = await screen.findByTitle(LONG)
    const text = option.querySelector('.ant-select-item-option-content > span') as HTMLElement
    expect(text).toHaveTextContent(LONG)
    expect(text).toHaveStyle({ whiteSpace: 'normal', overflowWrap: 'anywhere' })
  })
})
