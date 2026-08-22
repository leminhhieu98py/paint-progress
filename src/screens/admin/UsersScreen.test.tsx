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
  listGsUsers.mockResolvedValue([
    { id: 'u1', username: 'gs1', fullName: 'GS Một', active: true, projectId: 'p1', projectName: 'BB1' },
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

  it('reveals a password only when the action is clicked', async () => {
    revealPassword.mockResolvedValue('s3cret')
    render(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getByRole('button', { name: 'Xem mật khẩu' }))

    await waitFor(() => expect(screen.getByText('s3cret')).toBeInTheDocument())
    expect(revealPassword).toHaveBeenCalledWith('u1')
  })

  it('shows an error when reveal fails', async () => {
    revealPassword.mockRejectedValue(new Error('No stored credential'))
    render(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getByRole('button', { name: 'Xem mật khẩu' }))

    expect(await screen.findByText('No stored credential')).toBeInTheDocument()
  })
})
