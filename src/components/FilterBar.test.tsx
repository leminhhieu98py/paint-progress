import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input, Segmented, Select } from 'antd'
import { useState } from 'react'
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
    expect(bar).toHaveStyle({ display: 'flex', flexWrap: 'wrap', gap: `${space.md}px`, alignItems: 'center' })
  })

  it('lines its items up at the bottom for controls with a label above them, and takes its own name', () => {
    render(
      <FilterBar align="end" label="Bộ lọc bên phải" onApply={() => {}} onReset={() => {}}>
        <Select aria-label="Công đoạn" options={[]} />
      </FilterBar>,
    )
    const bar = screen.getByRole('search', { name: 'Bộ lọc bên phải' })
    expect(bar).toHaveStyle({ alignItems: 'flex-end' })
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
    expect(bar.lastElementChild?.lastElementChild).toBe(buttons[1])
  })

  it('draws Đặt lại as an outlined button, the height Tìm reads at (FLT-06)', () => {
    renderBar()
    const reset = screen.getByRole('button', { name: 'Đặt lại' })
    expect(reset).toHaveClass('ant-btn-default', 'ant-btn-variant-outlined')
    expect(reset).not.toHaveClass('ant-btn-text')
  })

  it('puts the pair at the right end of the bar, the filters on the left (FLT-06)', () => {
    const { bar } = renderBar()
    const unit = bar.lastElementChild as HTMLElement
    expect(unit).toContainElement(screen.getByRole('button', { name: /Tìm/ }))
    // The bar spans its row, so auto on the left takes up whatever the
    // filters leave: the pair's own row when the bar wraps, too.
    expect(unit).toHaveStyle({ marginLeft: 'auto' })
    expect(bar).toHaveStyle({ width: '100%' })
  })

  it('keeps Đặt lại and Tìm together, one unit the bar never wraps apart (FLT-05)', () => {
    const { bar } = renderBar()
    const unit = bar.lastElementChild as HTMLElement
    expect(Array.from(unit.children).map((b) => b.textContent)).toEqual(['Đặt lại', 'Tìm'])
    // The bar wraps whole controls; the pair itself neither wraps nor shrinks.
    expect(bar).toHaveStyle({ flexWrap: 'wrap' })
    expect(unit).toHaveStyle({ display: 'flex', flexWrap: 'nowrap', flex: 'none' })
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

  it('applies on Enter only from a text-like input, not from a Segmented option', async () => {
    const onApply = vi.fn()
    render(
      <FilterBar onApply={onApply} onReset={() => {}}>
        <Segmented aria-label="Công việc" options={['Sơn', 'Tháo giáo']} />
        <Input aria-label="Tìm" type="search" />
      </FilterBar>,
    )
    const option = screen.getAllByRole('radio')[1]
    option.focus()
    await userEvent.keyboard('{Enter}')
    expect(onApply).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm' }), '{Enter}')
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('shows Tìm as loading, and ignores it and Enter, while the options are still loading', async () => {
    const onApply = vi.fn()
    render(
      <FilterBar onApply={onApply} onReset={() => {}} applyLoading>
        <Input aria-label="Tìm" />
        <Select aria-label="Sàn" options={[]} />
      </FilterBar>,
    )
    const tim = screen.getByRole('button', { name: /Tìm/ })
    expect(tim).toHaveClass('ant-btn-loading')
    await userEvent.click(tim)
    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm' }), '{Enter}')
    expect(onApply).not.toHaveBeenCalled()
  })

  it('has no buttons when it holds one control, which applies as it changes', async () => {
    // A one-control bar is the screen's own onChange: what is typed is applied at once.
    function OneControl() {
      const [query, setQuery] = useState('')
      return (
        <>
          <FilterBar><Input aria-label="Tìm" value={query} onChange={(e) => setQuery(e.target.value)} /></FilterBar>
          <output>{`áp dụng: ${query}`}</output>
        </>
      )
    }
    render(<OneControl />)
    expect(within(screen.getByRole('search', { name: 'Bộ lọc' })).queryByRole('button')).toBeNull()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm' }), 'hai')
    expect(screen.getByText('áp dụng: hai')).toBeInTheDocument()
  })
})
