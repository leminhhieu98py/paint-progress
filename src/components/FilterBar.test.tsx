import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input, Select } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { space } from '../theme'
import { FilterBar } from './FilterBar'
import { ProjectSelect } from './ProjectSelect'

const PROJECTS = [
  { id: 'p1', name: 'Giàn A', code: 'GA' },
  { id: 'p2', name: 'Giàn B', code: 'GB' },
]

describe('FilterBar (FLT-01)', () => {
  it('is one search landmark that holds every control in one wrapping row', () => {
    render(
      <FilterBar>
        <Select aria-label="Sàn" options={[]} />
        <Select aria-label="Công đoạn" options={[]} />
      </FilterBar>,
    )
    const bar = screen.getByRole('search', { name: 'Bộ lọc' })
    expect(within(bar).getByRole('combobox', { name: 'Sàn' })).toBeInTheDocument()
    expect(within(bar).getByRole('combobox', { name: 'Công đoạn' })).toBeInTheDocument()
    expect(bar).toHaveStyle({ display: 'flex', flexWrap: 'wrap', gap: `${space.md}px` })
  })
})

describe('ProjectSelect (FLT-01)', () => {
  it('carries its name as an aria-label, no visible label, and shows the project as name (code)', () => {
    const { container } = render(<ProjectSelect projects={PROJECTS} value="p2" onChange={() => {}} />)
    expect(screen.getByRole('combobox', { name: 'Dự án' })).toBeInTheDocument()
    expect(container.querySelector('label')).toBeNull()
    expect(screen.getByTitle('Giàn B (GB)')).toBeInTheDocument()
  })

  it('shows its placeholder before a project is chosen', () => {
    render(<ProjectSelect projects={PROJECTS} value={null} onChange={() => {}} />)
    expect(screen.getByText('Chọn dự án')).toBeInTheDocument()
  })

  it('reports the picked project and can be searched by typing', async () => {
    const onChange = vi.fn()
    render(<ProjectSelect projects={PROJECTS} value="p1" onChange={onChange} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Dự án' }), 'gian b')
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    expect(onChange).toHaveBeenCalledWith('p2')
  })
})

describe('FilterBar with more than one control (FLT-02)', () => {
  const renderBar = () => {
    const onApply = vi.fn()
    const onReset = vi.fn()
    render(
      <FilterBar onApply={onApply} onReset={onReset}>
        <Input aria-label="Tìm" />
        <Select aria-label="Sàn" options={[{ value: 'a', label: 'Sàn A' }]} />
      </FilterBar>,
    )
    return { onApply, onReset, bar: screen.getByRole('search', { name: 'Bộ lọc' }) }
  }

  it('ends with Đặt lại, then Tìm as the primary button with a search icon', () => {
    const { bar } = renderBar()
    const buttons = within(bar).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Đặt lại', 'Tìm'])
    expect(buttons[1]).toHaveClass('ant-btn-primary')
    expect(buttons[1].querySelector('.anticon-search')).not.toBeNull()
    expect(buttons[0]).toHaveClass('ant-btn-text')
    expect(bar.lastElementChild).toBe(buttons[1])
  })

  it('applies on Tìm and resets on Đặt lại', async () => {
    const { onApply, onReset } = renderBar()
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }))
    expect(onApply).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Đặt lại' }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('applies on Enter in a text field of the bar, not on Enter in a select', async () => {
    const { onApply } = renderBar()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm' }), 'abc{Enter}')
    expect(onApply).toHaveBeenCalledOnce()
    await userEvent.type(screen.getByRole('combobox', { name: 'Sàn' }), '{Enter}')
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('has no buttons when it holds one control and applies as it changes', () => {
    render(<FilterBar><Input aria-label="Tìm" /></FilterBar>)
    expect(within(screen.getByRole('search', { name: 'Bộ lọc' })).queryByRole('button')).toBeNull()
  })
})
