import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeesScreen } from './EmployeesScreen'

const listEmployees = vi.hoisted(() => vi.fn())
const createEmployee = vi.hoisted(() => vi.fn())
const updateEmployee = vi.hoisted(() => vi.fn())
vi.mock('../../lib/employeesApi', () => ({
  listEmployees: (includeRetired: boolean) => listEmployees(includeRetired),
  createEmployee: (name: string) => createEmployee(name),
  updateEmployee: (id: string, fields: unknown) => updateEmployee(id, fields),
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
  listEmployees.mockResolvedValue(ROWS)
  createEmployee.mockResolvedValue('e9')
  updateEmployee.mockResolvedValue(undefined)
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
