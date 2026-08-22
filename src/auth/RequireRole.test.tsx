import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { RequireRole } from './RequireRole'

const getSession = vi.fn()
const onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
const maybeSingle = vi.fn()

// AuthProvider is exercised for real here (unlike LoginScreen.test.tsx, which
// mocks AuthProvider directly) because the bugs under test are in
// AuthProvider's own lifecycle. Only its Supabase dependency is faked.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...args),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  },
}))

const fakeSession = { access_token: 'token', user: { id: 'user-1' } } as unknown as Session

describe('RequireRole with a real AuthProvider', () => {
  it('shows a retry alert — not a stuck spinner or the bare 404 — when the profile fetch fails', async () => {
    getSession.mockResolvedValue({ data: { session: fakeSession } })
    maybeSingle.mockRejectedValue(new Error('network down'))

    render(
      <AuthProvider>
        <RequireRole role="admin">
          <div>Protected content</div>
        </RequireRole>
      </AuthProvider>,
    )

    expect(await screen.findByText('Không tải được thông tin tài khoản')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).toBeNull()
    expect(screen.queryByText('404')).toBeNull()
  })

  it('holds loading during a post-mount sign-in, so the bare 404 never flashes before the profile arrives', async () => {
    // Settle at mount with no session, so the event below is a genuine
    // post-mount transition — not the already-authenticated-at-mount case the
    // test above covers, which starts loading=true from useState(true) and
    // would stay green even if the fix regressed.
    getSession.mockResolvedValue({ data: { session: null } })

    let authCallback: ((event: string, next: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((cb: (event: string, next: Session | null) => void) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    let releaseProfile: (value: { data: unknown }) => void = () => {}
    const profilePromise = new Promise<{ data: unknown }>((resolve) => {
      releaseProfile = resolve
    })
    maybeSingle.mockReturnValue(profilePromise)

    render(
      <AuthProvider>
        <RequireRole role="admin">
          <div>Protected content</div>
        </RequireRole>
      </AuthProvider>,
    )

    // Confirm we're settled on the login screen before emitting the event.
    await screen.findByLabelText('Tên đăng nhập')

    act(() => {
      authCallback?.('SIGNED_IN', fakeSession)
    })

    // The profile fetch is still pending here: session is set, profile is
    // not. If loading were not held true across this window, RequireRole
    // would already be rendering the bare 404 instead of the spinner.
    expect(screen.queryByText('404')).toBeNull()
    expect(document.querySelector('.ant-spin-spinning')).not.toBeNull()

    await act(async () => {
      releaseProfile({
        data: { id: 'user-1', username: 'linh', full_name: 'Linh', role: 'admin', active: true },
      })
      await profilePromise
    })

    expect(await screen.findByText('Protected content')).toBeInTheDocument()
    expect(screen.queryByText('404')).toBeNull()
  })
})
