import { render, screen, waitFor } from '@testing-library/react'
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

  it('shows a Vietnamese network error and stops the loading state when signIn throws', async () => {
    signIn.mockRejectedValue(new Error('network down'))
    render(<LoginScreen />)

    await userEvent.type(screen.getByLabelText('Tên đăng nhập'), 'x')
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'y')
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    expect(
      await screen.findByText('Không kết nối được. Kiểm tra mạng rồi thử lại.'),
    ).toBeInTheDocument()

    const button = screen.getByRole('button', { name: 'Đăng nhập' })
    await waitFor(() => expect(button.className).not.toMatch(/loading/i))
  })

  it('renders no text that hints an app exists', () => {
    render(<LoginScreen />)
    expect(screen.queryByText(/paint|progress|sơn|tiến độ/i)).toBeNull()
  })
})
