import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UsersScreen } from './UsersScreen'

const listGsUsers = vi.fn()
const revealPassword = vi.fn()
const deactivateGsUser = vi.fn()
const listProjectNames = vi.fn()

vi.mock('../../lib/adminApi', () => ({
  listGsUsers: () => listGsUsers(),
  revealPassword: (id: string) => revealPassword(id),
  createGsUser: vi.fn(),
  setPassword: vi.fn(),
  deactivateGsUser: (id: string) => deactivateGsUser(id),
}))

vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))

beforeEach(() => {
  listGsUsers.mockReset()
  revealPassword.mockReset()
  deactivateGsUser.mockReset()
  listProjectNames.mockReset()
  deactivateGsUser.mockResolvedValue(undefined)
  listProjectNames.mockResolvedValue([])
  // Two rows so a reveal-the-wrong-row bug in the per-row `revealed[user.id]`
  // keying would actually show up in a test, instead of being masked by a
  // fixture with only one row to get right. Ids deliberately do not coincide
  // with the rows' array indices (0/1): if `revealed` (or any future per-row
  // state) were ever keyed by index instead of user.id, a fixture using '0'/'1'
  // -shaped ids like 'u1'/'u2' would still pass by accident.
  listGsUsers.mockResolvedValue([
    { id: 'u7', username: 'gs1', fullName: 'GS Một', active: true, projectId: 'p1', projectName: 'BB1' },
    { id: 'u9', username: 'gs2', fullName: 'GS Hai', active: true, projectId: 'p2', projectName: 'BB2' },
  ])
})

describe('UsersScreen', () => {
  it('lists GS accounts', async () => {
    render(<UsersScreen />)
    expect(await screen.findByText('gs1')).toBeInTheDocument()
    expect(screen.getByText('GS Một')).toBeInTheDocument()
    expect(screen.getByText('BB1')).toBeInTheDocument()
  })

  it('does not render any password before it is requested', async () => {
    revealPassword.mockResolvedValue('s3cret')
    render(<UsersScreen />)
    await screen.findByText('gs1')
    expect(screen.queryByText('s3cret')).toBeNull()
    expect(revealPassword).not.toHaveBeenCalled()
  })

  it('reveals a password only for the row that was clicked', async () => {
    revealPassword.mockImplementation((id: string) => Promise.resolve(id === 'u7' ? 's3cret' : 'other-secret'))
    render(<UsersScreen />)
    await screen.findByText('gs1')

    const revealButtons = screen.getAllByRole('button', { name: 'Xem mật khẩu' })
    await userEvent.click(revealButtons[0])

    await waitFor(() => expect(screen.getByText('s3cret')).toBeInTheDocument())
    expect(revealPassword).toHaveBeenCalledWith('u7')
    expect(revealPassword).not.toHaveBeenCalledWith('u9')
    expect(screen.queryByText('other-secret')).toBeNull()
    // The second row's button is still the un-revealed "Xem mật khẩu" state —
    // only the clicked row switched.
    expect(screen.getAllByRole('button', { name: 'Xem mật khẩu' })).toHaveLength(1)
  })

  it('hides a revealed password again when Ẩn is clicked', async () => {
    revealPassword.mockResolvedValue('s3cret')
    render(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Xem mật khẩu' })[0])
    await waitFor(() => expect(screen.getByText('s3cret')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Ẩn' }))

    expect(screen.queryByText('s3cret')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Xem mật khẩu' })).toHaveLength(2)
  })

  it('shows an error when reveal fails', async () => {
    revealPassword.mockRejectedValue(new Error('No stored credential'))
    render(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Xem mật khẩu' })[0])

    expect(await screen.findByText('No stored credential')).toBeInTheDocument()
  })

  it('deactivates only after the Popconfirm is confirmed, not from the switch click alone', async () => {
    // The Switch has no onChange -- clicking it only opens antd's Popconfirm
    // popup, which clones an onClick onto the child. That is invisible to a
    // reader who doesn't know antd's internals, so without this test someone
    // "fixing" the apparently-inert switch by wiring an onChange straight to
    // deactivateGsUser would skip the confirmation step entirely and this
    // suite would stay green.
    render(<UsersScreen />)
    await screen.findByText('gs1')

    const switches = screen.getAllByRole('switch')
    await userEvent.click(switches[0])

    expect(deactivateGsUser).not.toHaveBeenCalled()

    await userEvent.click(await screen.findByRole('button', { name: 'Vô hiệu hoá' }))

    await waitFor(() => expect(deactivateGsUser).toHaveBeenCalledWith('u7'))
  })
})
