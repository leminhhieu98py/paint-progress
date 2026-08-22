import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LoginScreen } from './LoginScreen'

const signIn = vi.fn()

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ signIn, session: null, profile: null, loading: false, signOut: vi.fn() }),
}))

describe('LoginScreen', () => {
  it('sends the identifier and password to signIn', async () => {
    signIn.mockResolvedValue({ error: null })
    render(<LoginScreen />)

    await userEvent.type(screen.getByLabelText('Tên đăng nhập'), 'linhdeptrai123')
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    expect(signIn).toHaveBeenCalledWith('linhdeptrai123', 'secret')
  })

  it('shows a Vietnamese error when sign-in is rejected', async () => {
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    render(<LoginScreen />)

    await userEvent.type(screen.getByLabelText('Tên đăng nhập'), 'x')
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'y')
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    expect(await screen.findByText('Tên đăng nhập hoặc mật khẩu không đúng')).toBeInTheDocument()
  })

  it('does not reveal that an app exists in the document title', () => {
    render(<LoginScreen />)
    expect(screen.queryByText(/paint|progress|sơn|tiến độ/i)).toBeNull()
  })
})
