import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from 'antd'
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
