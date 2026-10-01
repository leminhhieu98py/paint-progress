import { Alert, Button, Form, Grid, Input } from 'antd'
import type { AnimationItem } from 'lottie-web/build/player/lottie_light'
import { useEffect, useRef, useState } from 'react'
import { Copyright } from '../components/Copyright'
import { palette, shadowCard, type } from '../theme'
import { useAuth } from './AuthProvider'

interface Values {
  identifier: string
  password: string
}

/**
 * The hero panel beside the form: the illustration alone. Its tagline went in
 * Feedback Rv7 (RV7-1a).
 *
 * The login screen is the one thing a stranger who finds the URL can see. The
 * two protections that actually cost an attacker something are still in place
 * and must stay: robots noindex plus a blanket Disallow in robots.txt, and a
 * sign-in error that refuses to distinguish "no such user" from "wrong
 * password", so the form cannot be used to enumerate which usernames exist.
 *
 * Exported so a test can assert it carries no copy. antd's breakpoint hook
 * reports every screen false under jsdom, so the wide layout -- and this panel
 * with it -- never renders through LoginScreen in a test.
 */
export function Hero() {
  return (
    <div
      style={{
        background: 'linear-gradient(#F6FBFA, #EDF5F4)',
        padding: '0 48px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -130,
          bottom: -170,
          width: 540,
          height: 540,
          borderRadius: '50%',
          background: '#0A817517',
        }}
      />
      <LoginIllustration />
    </div>
  )
}

/**
 * The login screen's picture: an animation (see loginAnimation.ts for its
 * source and licence). The box is empty, at its full size so nothing shifts,
 * until the animation has drawn its first frame, and for good if the player
 * fails to load. A visitor who asks for reduced motion gets one still frame of
 * it, never played (RV7-1d).
 *
 * The player and the animation are one dynamic import, made only here, so
 * they are their own chunk and only the login screen downloads them. The
 * animation is destroyed with the screen and paused while the page is hidden,
 * so nothing keeps drawing once the visitor has signed in or looked away.
 *
 * Square, as the animation is (RV7-1c). Wide screens: the hero's slot, growing
 * with the viewport but never taller than 70vh, so the form stays in view.
 * Phones (`compact`): above the sign-in card, 200 px at most, in the page's
 * flow so that it scrolls away under the on-screen keyboard rather than
 * covering the inputs.
 *
 * Purely decorative, so `aria-hidden`.
 */
export function LoginIllustration({ compact = false }: { compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [motion] = useState(
    () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  const [failed, setFailed] = useState(false)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    let gone = false
    let animation: AnimationItem | undefined
    const onVisibility = () => {
      if (document.hidden) animation?.pause()
      else animation?.play()
    }
    import('./loginAnimation')
      .then(({ playLoginAnimation }) => {
        if (gone || !host.current) return
        animation = playLoginAnimation(host.current, { still: !motion })
        animation.addEventListener('DOMLoaded', () => {
          if (!gone) setDrawn(true)
        })
        // A still frame has nothing to pause, and must never be played.
        if (!motion) return
        document.addEventListener('visibilitychange', onVisibility)
        if (document.hidden) animation.pause()
      })
      .catch(() => {
        if (!gone) setFailed(true)
      })
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', onVisibility)
      animation?.destroy()
    }
  }, [motion])

  return (
    <div
      data-testid="login-illustration"
      aria-hidden
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        ...(compact
          ? { maxWidth: 200, margin: '0 auto 16px' }
          // Centred in the hero, which it now has to itself (RV7-1a).
          : { maxWidth: 'clamp(320px, 34vw, 560px)', maxHeight: '70vh', margin: '0 auto' }),
      }}
    >
      {!failed && (
        <div
          ref={host}
          data-testid="login-animation"
          style={{ position: 'absolute', inset: 0, display: drawn ? 'block' : 'none' }}
        />
      )}
    </div>
  )
}

export function LoginScreen() {
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const screens = Grid.useBreakpoint()
  const wide = screens.md === true

  const onFinish = async ({ identifier, password }: Values) => {
    setBusy(true)
    setError(null)
    try {
      const { error: signInError } = await signIn(identifier, password)
      if (signInError) {
        // Never echo the provider's message: it distinguishes "no such user"
        // from "wrong password" and would confirm which usernames exist.
        // `retryable` (not the message) is what tells a network/transport
        // failure apart from a genuine credential rejection.
        setError(
          signInError.retryable
            ? 'Không kết nối được. Kiểm tra mạng rồi thử lại.'
            : 'Tên đăng nhập hoặc mật khẩu không đúng',
        )
      }
    } catch {
      // Defensive only: signIn resolves failures as a value rather than
      // throwing, but this keeps the network copy reachable if a genuine
      // exception ever escapes it.
      setError('Không kết nối được. Kiểm tra mạng rồi thử lại.')
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <div
      style={
        wide
          ? { width: '100%', maxWidth: 360 }
          : {
              width: '100%',
              maxWidth: 380,
              background: palette.bgContainer,
              border: `1px solid ${palette.borderCard}`,
              borderRadius: 18,
              boxShadow: shadowCard,
              padding: '26px 24px 28px',
            }
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            display: 'inline-block',
            width: 28,
            height: 28,
            borderRadius: 9,
            background: palette.accent,
            flex: 'none',
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Construction Management</span>
      </div>
      <h1
        style={{
          margin: '20px 0 22px',
          // The page title's step (TYP-01, M3): it was 21/600.
          ...type.pageTitle,
          lineHeight: 1.25,
          letterSpacing: '-0.028em',
        }}
      >
        Đăng nhập
      </h1>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

      <Form<Values> layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="identifier"
          label="Tên đăng nhập"
          rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}
        >
          <Input autoComplete="username" autoFocus placeholder="Tên đăng nhập được cấp" />
        </Form.Item>
        <Form.Item
          name="password"
          label="Mật khẩu"
          rules={[{ required: true, message: 'Nhập mật khẩu' }]}
        >
          <Input.Password autoComplete="current-password" placeholder="Mật khẩu được cấp" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy} style={{ height: 46 }}>
          Đăng nhập
        </Button>
      </Form>

      <p style={{ margin: '16px 0 0', fontSize: 12, lineHeight: 1.5, color: palette.textTertiary }}>
        Tài khoản do quản trị viên cấp. Quên mật khẩu thì liên hệ quản trị viên.
      </p>
    </div>
  )

  // The copyright line ends the page (RV7-2): the bottom of the column on a
  // phone, the bottom right of the page on a wide screen.
  if (!wide) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 18px 0',
          background: palette.bgPage,
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LoginIllustration compact />
          {form}
        </div>
        {/* Its right edge on the card's, which spans the column on a phone. */}
        <Copyright paddingInline={0} />
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 460px)',
        background: palette.bgContainer,
      }}
    >
      <Hero />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 48px',
          }}
        >
          {form}
        </div>
        <Copyright />
      </div>
    </div>
  )
}
