import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeesScreen } from './EmployeesScreen'
import { expectLeft } from '../../test/alignment'
import { pageSubtitle } from '../../test/copy'

const listEmployees = vi.hoisted(() => vi.fn())
const createEmployee = vi.hoisted(() => vi.fn())
const updateEmployee = vi.hoisted(() => vi.fn())
vi.mock('../../lib/employeesApi', () => ({
  listEmployees: (includeRetired: boolean) => listEmployees(includeRetired),
  createEmployee: (name: string) => createEmployee(name),
  updateEmployee: (id: string, fields: unknown) => updateEmployee(id, fields),
}))
const buildEmployeesXlsx = vi.hoisted(() => vi.fn())
vi.mock('../../lib/employeesXlsx', () => ({
  buildEmployeesXlsx: (rows: unknown) => buildEmployeesXlsx(rows),
  employeesFileName: (today: string) => `nhan-vien-${today}.xlsx`,
}))
const downloadWorkbook = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectReport', () => ({
  downloadWorkbook: (blob: unknown, name: string) => downloadWorkbook(blob, name),
}))

const ROWS = [
  { id: 'e1', fullName: 'Lê Văn A', active: true },
  { id: 'e2', fullName: 'Trần Thị B', active: false },
]

const renderScreen = () => render(<AntApp><EmployeesScreen /></AntApp>)

beforeEach(() => {
  listEmployees.mockReset()
  createEmployee.mockReset()
  updateEmployee.mockReset()
  buildEmployeesXlsx.mockReset()
  downloadWorkbook.mockReset()
  listEmployees.mockResolvedValue(ROWS)
  createEmployee.mockResolvedValue('e9')
  updateEmployee.mockResolvedValue(undefined)
  buildEmployeesXlsx.mockResolvedValue(new Blob(['x']))
})

describe('EmployeesScreen', () => {
  it('lists everyone, retired included, and counts who is still working', async () => {
    // The admin's own screen sees the retired rows: they are the ones a
    // mistaken switch has to be undone on.
    renderScreen()
    expect(await screen.findByText('Lê Văn A')).toBeInTheDocument()
    expect(screen.getByText('Trần Thị B')).toBeInTheDocument()
    expect(listEmployees).toHaveBeenCalledWith(true)
    expect(screen.getByText(/1 đang làm · 2 tên trong danh sách/)).toBeInTheDocument()
  })

  it('keeps the counts in the subtitle and nothing after them (CPY-01)', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    expect(pageSubtitle()).toHaveTextContent(/^1 đang làm · 2 tên trong danh sách$/)
  })

  it('searches from the filter bar under the page title, not from inside the card (FLT-01)', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    const bar = screen.getByRole('search', { name: 'Bộ lọc' })
    expect(within(bar).getByRole('textbox', { name: 'Tìm nhân viên' })).toHaveAttribute('placeholder', 'Tìm theo mã hoặc tên')
    const card = screen.getByRole('heading', { name: 'Danh sách nhân viên' }).closest('section') as HTMLElement
    expect(within(card).queryByRole('textbox', { name: 'Tìm nhân viên' })).toBeNull()
    // The page actions stay in the title row.
    expect(within(bar).queryByRole('button', { name: /Thêm nhân viên|Xuất danh sách/ })).toBeNull()
  })

  it('has no subtitle while the roster loads (CPY-03)', async () => {
    listEmployees.mockReturnValue(new Promise(() => {}))
    renderScreen()
    expect(await screen.findByRole('heading', { level: 1, name: 'Nhân viên' })).toBeInTheDocument()
    expect(pageSubtitle()).toBeNull()
  })

  it('states who uses the roster and what switching someone off keeps, under Quy tắc áp dụng (CPY-01)', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    expect(screen.queryByText(/GS chọn nhóm trưởng và thợ chính/)).toBeNull()
    expect(screen.queryByText(/Tắt một người thì họ không còn hiện/)).toBeNull()
    const card = screen.getByRole('heading', { name: 'Danh sách nhân viên' }).closest('section') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: /Quy tắc áp dụng/ }))
    expect(within(card).getByText('GS chọn nhóm trưởng và thợ chính từ danh sách này; GS không sửa được.')).toBeInTheDocument()
    expect(within(card).getByText(/^Tắt một người thì họ không còn hiện trong ô chọn của GS/)).toBeInTheDocument()
  })

  it('adds a name and re-reads the list', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    await userEvent.click(screen.getByRole('button', { name: /Thêm nhân viên/ }))
    await userEvent.type(await screen.findByLabelText('Họ tên'), 'Nguyễn Văn C')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(createEmployee).toHaveBeenCalledWith('Nguyễn Văn C'))
    await waitFor(() => expect(listEmployees).toHaveBeenCalledTimes(2))
  })

  it('shows the server\'s complaint about a duplicate instead of swallowing it', async () => {
    createEmployee.mockRejectedValue(new Error('Đã có nhân viên tên "Lê Văn A".'))
    renderScreen()
    await screen.findByText('Lê Văn A')
    await userEvent.click(screen.getByRole('button', { name: /Thêm nhân viên/ }))
    await userEvent.type(await screen.findByLabelText('Họ tên'), 'Lê Văn A')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect((await screen.findAllByText('Đã có nhân viên tên "Lê Văn A".')).length).toBeGreaterThan(0)
  })

  it('renames one person', async () => {
    renderScreen()
    const row = (await screen.findByText('Lê Văn A')).closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Sửa tên' }))

    const name = await screen.findByLabelText('Họ tên')
    await userEvent.clear(name)
    await userEvent.type(name, 'Lê Văn A2')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e1', { fullName: 'Lê Văn A2' }))
  })

  it('retires and brings back, without deleting anything', async () => {
    // The history names people; deleting the row would not clean it, only take
    // them out of the foreman's picker -- which the switch does, reversibly.
    renderScreen()
    await screen.findByText('Lê Văn A')
    await userEvent.click(screen.getByRole('switch', { name: 'Đang làm · Lê Văn A' }))
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e1', { active: false }))

    await userEvent.click(screen.getByRole('switch', { name: 'Đang làm · Trần Thị B' }))
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e2', { active: true }))
  })

  it('tells the admin an empty roster blocks the foreman', async () => {
    listEmployees.mockResolvedValue([])
    renderScreen()
    expect(
      await screen.findByText('Chưa có nhân viên nào. Thêm để GS ghi được tiến độ.'),
    ).toBeInTheDocument()
  })

  it('surfaces a failed read with a retry', async () => {
    listEmployees.mockRejectedValueOnce(new Error('mất kết nối'))
    renderScreen()
    expect(await screen.findByText('mất kết nối')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('Lê Văn A')).toBeInTheDocument()
  })
})

describe('EmployeesScreen — search and export (Feedback Rv5, item 4)', () => {
  /** The roster as the customer keeps it: "<mã> - <họ tên>", and the odd row
   *  with no code at all. */
  const ROSTER = [
    { id: 'e1', fullName: 'MC005593 - Cao Minh Hải', active: true },
    { id: 'e2', fullName: 'MC005594 - Đoàn Công Linh', active: true },
    { id: 'e3', fullName: 'GG', active: false },
  ]
  const search = () => screen.getByRole('textbox', { name: 'Tìm nhân viên' })
  const names = () =>
    screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label')?.replace('Đang làm · ', ''))

  beforeEach(() => listEmployees.mockResolvedValue(ROSTER))

  it('filters by any part of the name, ignoring case and tones', async () => {
    renderScreen()
    await screen.findByText('MC005593 - Cao Minh Hải')
    await userEvent.type(search(), 'hai')
    expect(names()).toEqual(['MC005593 - Cao Minh Hải'])
  })

  it('reaches a name behind đ, which no tone-stripping alone would find', async () => {
    renderScreen()
    await screen.findByText('MC005593 - Cao Minh Hải')
    await userEvent.type(search(), 'doan cong')
    expect(names()).toEqual(['MC005594 - Đoàn Công Linh'])
  })

  it('matches the code as well as the name, since the roster stores one string', async () => {
    renderScreen()
    await screen.findByText('MC005593 - Cao Minh Hải')
    await userEvent.type(search(), '005594')
    expect(names()).toEqual(['MC005594 - Đoàn Công Linh'])
  })

  it('counts the filter in the header, with the whole roster still beside it', async () => {
    renderScreen()
    expect(await screen.findByText(/2 đang làm · 3 tên trong danh sách/)).toBeInTheDocument()
    await userEvent.type(search(), 'hai')
    expect(screen.getByText(/1 đang làm · 1\/3 tên khớp tìm kiếm/)).toBeInTheDocument()
  })

  it('exports the whole roster, retired names included, not the filtered view', async () => {
    // RV5-08. A name taken out of the GS picker is still on every update it
    // was ever recorded against, so the file has to carry it.
    renderScreen()
    await screen.findByText('MC005593 - Cao Minh Hải')
    await userEvent.type(search(), 'hai')
    await userEvent.click(screen.getByRole('button', { name: /Xuất danh sách/ }))

    await waitFor(() => expect(buildEmployeesXlsx).toHaveBeenCalledWith(ROSTER))
    await waitFor(() => expect(downloadWorkbook).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringMatching(/^nhan-vien-\d{4}-\d{2}-\d{2}\.xlsx$/),
    ))
  })

  it('says on the button that the file is everyone, including the retired', async () => {
    renderScreen()
    await screen.findByText('MC005593 - Cao Minh Hải')
    await userEvent.hover(screen.getByRole('button', { name: /Xuất danh sách/ }))
    expect(await screen.findByText(/cả người đã nghỉ/)).toBeInTheDocument()
  })

  it('says when a search matches nobody, rather than looking like an empty roster', async () => {
    renderScreen()
    await screen.findByText('MC005593 - Cao Minh Hải')
    await userEvent.type(search(), 'zzz')
    expect(screen.getByText('Không có tên nào khớp')).toBeInTheDocument()
  })

  it('surfaces a failed export instead of leaving the button spinning', async () => {
    buildEmployeesXlsx.mockRejectedValue(new Error('hết bộ nhớ'))
    renderScreen()
    await screen.findByText('MC005593 - Cao Minh Hải')
    await userEvent.click(screen.getByRole('button', { name: /Xuất danh sách/ }))
    expect((await screen.findAllByText('hết bộ nhớ')).length).toBeGreaterThan(0)
  })
})

describe('EmployeesScreen — alignment (UI-03)', () => {
  it('keeps the person left and centres the switch and the action, header included', async () => {
    renderScreen()
    const name = await screen.findByText('Lê Văn A')
    expectLeft(screen.getByRole('columnheader', { name: 'Họ tên' }))
    expectLeft(name.closest('td'))
    expect(screen.getByRole('columnheader', { name: 'Đang làm' })).toHaveStyle({ textAlign: 'center' })
    const row = name.closest('tr') as HTMLElement
    expect(within(row).getByRole('switch').closest('td')).toHaveStyle({ textAlign: 'center' })
    expect(within(row).getByRole('button', { name: 'Sửa tên' }).closest('td')).toHaveStyle({ textAlign: 'center' })
  })
})

describe('EmployeesScreen — the pager follows the search (UI-06)', () => {
  // 30 names: the first 12 carry "Hải", the other 18 do not. Sorted as the
  // list shows them, so page 3 holds rows 21-30, none of them a match.
  const ROSTER = Array.from({ length: 30 }, (_, i) => ({
    id: `e${i}`,
    fullName: `NV${String(i).padStart(2, '0')} - ${i < 12 ? 'Cao Minh Hải' : 'Trần Văn Bình'}`,
    active: true,
  }))
  const shownNames = () =>
    screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label')?.replace('Đang làm · ', ''))

  beforeEach(() => listEmployees.mockResolvedValue(ROSTER))

  it('goes back to page 1 when the search changes, so the first matches are not hidden', async () => {
    renderScreen()
    await screen.findByText('NV00 - Cao Minh Hải')
    await userEvent.click(screen.getByTitle('3'))
    expect(await screen.findByText('NV20 - Trần Văn Bình')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm nhân viên' }), 'hai')
    await waitFor(() => expect(shownNames()[0]).toBe('NV00 - Cao Minh Hải'))
    expect(shownNames()).toHaveLength(10)
    expect(screen.getByTitle('1')).toHaveClass('ant-pagination-item-active')
  })
})
