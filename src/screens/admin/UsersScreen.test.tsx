import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UsersScreen } from './UsersScreen'

const listGsUsers = vi.fn()
const revealPassword = vi.fn()

vi.mock('../../lib/adminApi', () => ({
  listGsUsers: () => listGsUsers(),
  revealPassword: (id: string) => revealPassword(id),
  createGsUser: vi.fn(),
  setPassword: vi.fn(),
  deactivateGsUser: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}))

beforeEach(() => {
  listGsUsers.mockReset()
  revealPassword.mockReset()
  // Two rows so a reveal-the-wrong-row bug in the per-row `revealed[user.id]`
  // keying would actually show up in a test, instead of being masked by a
  // fixture with only one row to get right.
  listGsUsers.mockResolvedValue([
    { id: 'u1', username: 'gs1', fullName: 'GS Một', active: true, projectId: 'p1', projectName: 'BB1' },
    { id: 'u2', username: 'gs2', fullName: 'GS Hai', active: true, projectId: 'p2', projectName: 'BB2' },
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
    revealPassword.mockImplementation((id: string) => Promise.resolve(id === 'u1' ? 's3cret' : 'other-secret'))
    render(<UsersScreen />)
    await screen.findByText('gs1')

    const revealButtons = screen.getAllByRole('button', { name: 'Xem mật khẩu' })
    await userEvent.click(revealButtons[0])

    await waitFor(() => expect(screen.getByText('s3cret')).toBeInTheDocument())
    expect(revealPassword).toHaveBeenCalledWith('u1')
    expect(revealPassword).not.toHaveBeenCalledWith('u2')
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
})
