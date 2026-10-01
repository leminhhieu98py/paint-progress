import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import lottie from 'lottie-web/build/player/lottie_light'
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
    expect(screen.getByText('Construction Management')).toBeInTheDocument()
  })

  it('shows the illustration above the sign-in card on a phone, no wider than 200', () => {
    // jsdom reports every breakpoint false, so this is the phone layout.
    render(<LoginScreen />)
    const illustration = screen.getByTestId('login-illustration')
    const heading = screen.getByRole('heading', { name: 'Đăng nhập' })

    expect(
      illustration.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(illustration).toHaveStyle({ maxWidth: '200px' })
  })

  // The player here is the shared stub from test-setup.ts, which records what
  // the screen asks of it.
  it('starts the animation in the illustration and destroys it with the screen', async () => {
    const loadAnimation = vi.mocked(lottie.loadAnimation)
    loadAnimation.mockClear()
    const { unmount } = render(<LoginScreen />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })

    expect(loadAnimation).toHaveBeenCalledTimes(1)
    expect(loadAnimation.mock.calls[0][0].container).toBe(screen.getByTestId('login-animation'))
    const animation = loadAnimation.mock.results[0].value
    unmount()
    expect(animation.destroy).toHaveBeenCalledTimes(1)
  })

  it('sets the sign-in title on the type scale (M3, TYP-01)', () => {
    render(<LoginScreen />)
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toHaveStyle({ fontSize: '20px', fontWeight: '600' })
  })

  // RV7-1a: the wide-screen hero is the illustration alone, no tagline.
  // Asserted on Hero directly: antd's breakpoint hook reports every screen
  // false under jsdom, so the wide layout never renders through LoginScreen.
  it('carries the illustration and no tagline in the wide-screen hero', () => {
    const { container } = render(<Hero />)
    expect(screen.getByTestId('login-illustration')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByText('Quản lý tiến độ thi công ngay trên bản vẽ.')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
