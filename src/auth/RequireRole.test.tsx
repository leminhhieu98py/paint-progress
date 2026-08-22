import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { RequireRole } from './RequireRole'

const getSession = vi.fn()
const onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
const maybeSingle = vi.fn()

// AuthProvider is exercised for real here (unlike LoginScreen.test.tsx, which
// mocks AuthProvider directly) because the bug under test is in AuthProvider's
// own lifecycle. Only its Supabase dependency is faked.
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
})
