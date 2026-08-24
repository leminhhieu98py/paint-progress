import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toAuthEmail } from '../config'
import { supabase } from '../lib/supabase'

export interface Profile {
  id: string
  username: string
  fullName: string
  role: 'admin' | 'gs'
  active: boolean
}

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** True when a session exists but its profile could not be read. */
  profileError: boolean
  signIn: (
    identifier: string,
    password: string,
  ) => Promise<{ error: { message: string; retryable: boolean } | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, full_name, role, active')
    .eq('id', userId)
    .maybeSingle()

  // postgrest-js resolves failures as a value instead of throwing: a
  // network blip or a paused project comes back as `{ data: null, error }`,
  // not a rejection. Discarding `error` here would make that
  // indistinguishable from "no profile row exists" and this function would
  // return null either way -- which is exactly the bug this fixes: the
  // caller's catch block (and the retry Alert it drives) would never run,
  // and a legitimately signed-in user would see the bare 404 instead.
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    username: data.username,
    fullName: data.full_name,
    role: data.role,
    active: data.active,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let generation = 0
    // Whose profile the provider is currently holding. Read by the auth
    // listener below to tell "the token changed" from "the account changed".
    let currentUserId: string | null = null

    const resolve = async (next: Session | null) => {
      const mine = ++generation
      // Only the newest invocation may write results. Two auth events in quick
      // succession (a SIGNED_OUT immediately followed by a SIGNED_IN for a
      // different account, or a TOKEN_REFRESHED racing a slow initial fetch)
      // would otherwise let the older, slower fetch land after the newer one
      // and overwrite its correct profile with a stale one.
      const isCurrent = () => !cancelled && mine === generation

      // Every auth change re-opens a window where the session is known but the
      // profile is not. RequireRole reads "session but no profile" as
      // unauthorised, so without holding loading true across that window every
      // successful login flashes the bare 404 before landing.
      setLoading(true)
      setProfileError(false)
      try {
        // Synchronous and unguarded on purpose: invocations run this in
        // arrival order, so the last event always wins here regardless of how
        // the awaited fetch below resolves.
        setSession(next)
        currentUserId = next?.user?.id ?? null
        const nextProfile = next?.user ? await fetchProfile(next.user.id) : null
        if (isCurrent()) setProfile(nextProfile)
      } catch {
        // A failed profile read must not strand the UI in a spinner, and must
        // not look like "unauthorised" either -- the credentials were fine.
        if (isCurrent()) {
          setProfile(null)
          setProfileError(true)
        }
      } finally {
        if (isCurrent()) setLoading(false)
      }
    }

    void supabase.auth
      .getSession()
      .then(({ data }) => resolve(data.session))
      .catch(() => {
        // A rejected getSession means we cannot determine auth state at all.
        // Falling through to the login screen is the safe reading: worst case
        // the user signs in again. Leaving loading true would strand them in
        // a spinner, which is the bug this whole round exists to close.
        if (cancelled) return
        setSession(null)
        currentUserId = null
        setProfile(null)
        setLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // getSession() above already handled the initial read. Letting
      // INITIAL_SESSION through too would fetch the profile twice on every
      // mount. Skipping it here rather than dropping getSession() on purpose:
      // if that event ever failed to fire, loading would stick true forever,
      // which is the exact bug this round is fixing.
      if (event === 'INITIAL_SESSION') return

      // Same account, new token: nothing this provider exposes has changed
      // except the token itself, so take it and leave the tree alone.
      //
      // Going through resolve() here was a data-loss bug, not an
      // inefficiency. resolve() holds `loading` true across the profile
      // fetch, and RequireRole renders a spinner INSTEAD of its children
      // while it is -- so a routine token refresh unmounted whatever screen
      // the user was on and threw away its state. supabase-js emits
      // TOKEN_REFRESHED on its own timer and re-checks the session every time
      // the tab becomes visible again, so this fired on nothing more than
      // switching windows and coming back: the deck editor came back empty,
      // with the admin's detected cells, guides and selection gone, and any
      // save they had just clicked silently dropped mid-flight.
      //
      // The profile is deliberately not re-read: it belongs to the profiles
      // table, which a token refresh says nothing about.
      const nextUserId = next?.user?.id ?? null
      if (nextUserId !== null && nextUserId === currentUserId) {
        setSession(next)
        return
      }

      void resolve(next)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      loading,
      profileError,
      signIn: async (identifier, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email: toAuthEmail(identifier),
          password,
        })
        // auth-js resolves a network/transport failure as an
        // AuthRetryableFetchError value rather than throwing, so it must be
        // told apart here from a genuine credential rejection -- the caller
        // (LoginScreen) uses `retryable` to choose which Vietnamese copy to
        // show, and never echoes `message` (it would reveal whether a
        // username exists).
        return {
          error: error ? { message: error.message, retryable: isAuthRetryableFetchError(error) } : null,
        }
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, profile, loading, profileError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
