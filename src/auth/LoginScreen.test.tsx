import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Hero, LoginScreen } from './LoginScreen'

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
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials', retryable: false } })
    render(<LoginScreen />)

    await userEvent.type(screen.getByLabelText('Tên đăng nhập'), 'x')
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'y')
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    expect(await screen.findByText('Tên đăng nhập hoặc mật khẩu không đúng')).toBeInTheDocument()
    // The screen now names the product, so this is the protection that is left:
    // one message for both failures. The provider distinguishes "no such user"
    // from "wrong password", and echoing it turns the form into a way to ask
    // which usernames exist.
    expect(screen.queryByText(/Invalid login credentials/i)).toBeNull()
  })

  // This is the shape production actually produces: auth-js resolves a
  // network/transport failure as a value (an AuthRetryableFetchError, here
  // reduced to signIn's { message, retryable } contract) rather than
  // throwing. The message itself must never reach the screen either way.
  it('shows a Vietnamese network error and stops the loading state when signIn returns a retryable error', async () => {
    signIn.mockResolvedValue({ error: { message: 'fetch failed', retryable: true } })
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

  // Defensive coverage only: signIn should never actually reject (auth-js
  // resolves failures as values), but the same network copy must still show
  // up if one ever does.
  it('shows the same Vietnamese network error if signIn ever rejects', async () => {
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

  it('names the product on the sign-in card', () => {
    render(<LoginScreen />)
    expect(screen.getByText('Paint Progress')).toBeInTheDocument()
  })

  it('carries the approved headline in the wide-screen hero', () => {
    // Asserted on Hero directly: antd's breakpoint hook reports every screen
    // false under jsdom, so the wide layout never renders through LoginScreen
    // in a test and this copy would otherwise go unchecked.
    render(<Hero />)
    expect(
      screen.getByRole('heading', { name: 'Tiến độ sơn theo từng ô, ngay trên bản vẽ.' }),
    ).toBeInTheDocument()
  })
})
