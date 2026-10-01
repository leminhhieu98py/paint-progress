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
      <FilterBar align="end" label="Bộ lọc bên phải">
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

describe('FilterBar applies as it changes (RV7-3)', () => {
  it('has no Đặt lại and no Tìm, however many controls it holds', () => {
    render(
      <FilterBar>
        <Input aria-label="Tìm" />
        <Select aria-label="Sàn" options={[{ value: 'a', label: 'Sàn A' }]} />
        <Segmented aria-label="Công việc" options={['Sơn', 'Tháo giáo']} />
      </FilterBar>,
    )
    expect(within(screen.getByRole('search', { name: 'Bộ lọc' })).queryByRole('button')).toBeNull()
  })

  it('leaves what is typed to the screen\'s own onChange, applied at once', async () => {
    function TwoControls() {
      const [query, setQuery] = useState('')
      return (
        <>
          <FilterBar>
            <Input aria-label="Tìm" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Select aria-label="Sàn" options={[]} />
          </FilterBar>
          <output>{`áp dụng: ${query}`}</output>
        </>
      )
    }
    render(<TwoControls />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm' }), 'hai')
    expect(screen.getByText('áp dụng: hai')).toBeInTheDocument()
  })
})
