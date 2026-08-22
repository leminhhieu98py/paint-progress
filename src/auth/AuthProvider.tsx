import type { Session } from '@supabase/supabase-js'
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
  signIn: (identifier: string, password: string) => Promise<{ error: { message: string } | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, full_name, role, active')
    .eq('id', userId)
    .maybeSingle()

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

    const resolve = async (next: Session | null) => {
      if (cancelled) return
      // Every auth change re-opens a window where the session is known but the
      // profile is not. RequireRole reads "session but no profile" as
      // unauthorised, so without holding loading true across that window every
      // successful login flashes the bare 404 before landing.
      setLoading(true)
      setProfileError(false)
      try {
        setSession(next)
        setProfile(next?.user ? await fetchProfile(next.user.id) : null)
      } catch {
        // A failed profile read must not strand the UI in a spinner, and must
        // not look like "unauthorised" either -- the credentials were fine.
        if (!cancelled) {
          setProfile(null)
          setProfileError(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void supabase.auth.getSession().then(({ data }) => resolve(data.session))

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // getSession() above already handled the initial read. Letting
      // INITIAL_SESSION through too would fetch the profile twice on every
      // mount. Skipping it here rather than dropping getSession() on purpose:
      // if that event ever failed to fire, loading would stick true forever,
      // which is the exact bug this round is fixing.
      if (event === 'INITIAL_SESSION') return
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
        return { error: error ? { message: error.message } : null }
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
