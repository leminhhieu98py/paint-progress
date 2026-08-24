import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import { act, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'
import { RequireRole } from './RequireRole'

const getSession = vi.fn()
const onAuthStateChange = vi.fn((_cb?: (event: string, next: Session | null) => void) => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}))
const maybeSingle = vi.fn()

// AuthProvider is exercised for real here (unlike LoginScreen.test.tsx, which
// mocks AuthProvider directly) because the bugs under test are in
// AuthProvider's own lifecycle. Only its Supabase dependency is faked.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      onAuthStateChange: (cb?: (event: string, next: Session | null) => void) =>
        onAuthStateChange(cb),
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
    // postgrest-js does not reject on a failed read -- it resolves with a
    // populated `error` and `data: null`. That is the shape a real failure
    // (a network blip, a paused project) produces in production, so that is
    // what must be mocked here -- as opposed to a genuinely missing row,
    // which resolves with both `data` and `error` null and must keep
    // falling through to the bare 404 (see RequireRole.tsx).
    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'network down', details: '', hint: '', code: '' },
    })

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
    onAuthStateChange.mockImplementation((cb?: (event: string, next: Session | null) => void) => {
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
  it('rides out a token refresh for the same account without unmounting the screen', async () => {
    // The defect this pins: every auth event re-entered the gate, and
    // RequireRole swaps the whole tree for a spinner while loading is held --
    // so holding it unmounts the screen underneath. TOKEN_REFRESHED arrives on
    // its own timer AND every time the tab is focused again, which made an
    // admin who alt-tabbed away come back to a remounted screen with every
    // unsaved edit on it gone: guides, detected cells, the crop, the selection.
    getSession.mockResolvedValue({ data: { session: fakeSession } })
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'linh', full_name: 'Linh', role: 'admin', active: true },
      error: null,
    })

    let authCallback: ((event: string, next: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((cb?: (event: string, next: Session | null) => void) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    // Counts mounts rather than asserting the text is still on screen: a
    // remount that finishes before the assertion runs would leave identical
    // text behind, and that is precisely the case that loses the admin's work.
    let mounts = 0
    function Screen() {
      const { session } = useAuth()
      useEffect(() => {
        mounts += 1
      }, [])
      return <div>{`Protected content ${session?.access_token}`}</div>
    }

    render(
      <AuthProvider>
        <RequireRole role="admin">
          <Screen />
        </RequireRole>
      </AuthProvider>,
    )

    expect(await screen.findByText('Protected content token')).toBeInTheDocument()
    const mountsBefore = mounts
    const profileReads = maybeSingle.mock.calls.length

    act(() => {
      authCallback?.('TOKEN_REFRESHED', { ...fakeSession, access_token: 'fresher' } as Session)
    })

    // Asserted synchronously on purpose: the failure is what the screen looks
    // like DURING the event, not what it settles back to afterwards.
    expect(document.querySelector('.ant-spin-spinning')).toBeNull()
    expect(mounts).toBe(mountsBefore)
    // The refreshed token still has to reach consumers -- skipping the gate
    // must not also mean skipping the update.
    expect(screen.getByText('Protected content fresher')).toBeInTheDocument()
    // A token refresh says nothing about the profiles row, so re-reading it is
    // a round trip bought for nothing.
    expect(maybeSingle.mock.calls.length).toBe(profileReads)
  })
})
