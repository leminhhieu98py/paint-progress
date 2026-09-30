import { Alert, Button, Form, Grid, Input } from 'antd'
import type { AnimationItem } from 'lottie-web/build/player/lottie_light'
import { useEffect, useRef, useState } from 'react'
import { palette, shadowCard, type } from '../theme'
import { useAuth } from './AuthProvider'

interface Values {
  identifier: string
  password: string
}

/**
 * The hero panel beside the form: the trade, drawn, and what the product does.
 *
 * This panel used to be wordless. The login screen is the one thing a stranger
 * who finds the URL can see, and naming the product and the trade here tells
 * them both. That was raised and the owner decided to name it, so it is named
 * -- but only the copy changed. The two protections that actually cost an
 * attacker something are still in place and must stay: robots noindex plus a
 * blanket Disallow in robots.txt, and a sign-in error that refuses to
 * distinguish "no such user" from "wrong password", so the form cannot be used
 * to enumerate which usernames exist.
 *
 * Exported so a test can assert the approved copy directly. antd's breakpoint
 * hook reports every screen false under jsdom, so the wide layout -- and this
 * panel with it -- never renders through LoginScreen in a test.
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
      <h2
        style={{
          position: 'relative',
          margin: '28px 0 0',
          // On the scale (TYP-01, M3): it was 19/600.
          ...type.cardTitle,
          lineHeight: 1.35,
          letterSpacing: '-0.024em',
          maxWidth: 300,
        }}
      >
        Quản lý tiến độ thi công ngay trên bản vẽ.
      </h2>
    </div>
  )
}

/**
 * The login screen's picture: a construction animation (see loginAnimation.ts
 * for its source and licence), with the drawn platform below standing in for
 * it until the animation has drawn its first frame, instead of it when the
 * visitor asks for reduced motion, and for good if the player fails to load.
 *
 * The player and the animation are one dynamic import, made only here, so
 * they are their own chunk and only the login screen downloads them. The
 * animation is destroyed with the screen and paused while the page is hidden,
 * so nothing keeps drawing once the visitor has signed in or looked away.
 *
 * Wide screens: the hero's slot, 372 px wide at most, which also keeps the
 * raster frames (750 px wide) from ever being upscaled. Phones (`compact`):
 * above the sign-in card, 160 px tall at most, in the page's flow so that it
 * scrolls away under the on-screen keyboard rather than covering the inputs.
 *
 * Purely decorative, so `aria-hidden`, as the drawn platform always was.
 */
export function LoginIllustration({ compact = false }: { compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [motion] = useState(
    () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  const [failed, setFailed] = useState(false)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    if (!motion) return
    let gone = false
    let animation: AnimationItem | undefined
    const onVisibility = () => {
      if (document.hidden) animation?.pause()
      else animation?.play()
    }
    import('./loginAnimation')
      .then(({ playLoginAnimation }) => {
        if (gone || !host.current) return
        animation = playLoginAnimation(host.current)
        animation.addEventListener('DOMLoaded', () => {
          if (!gone) setDrawn(true)
        })
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
        aspectRatio: '750 / 500',
        ...(compact
          ? { maxWidth: 240, maxHeight: 160, margin: '0 auto 16px' }
          // Grows with the viewport beside the wide hero column (owner 2026-09-30).
          : { maxWidth: 'clamp(372px, 42vw, 720px)' }),
      }}
    >
      {!drawn && <Platform />}
      {motion && !failed && (
        <div
          ref={host}
          data-testid="login-animation"
          style={{ position: 'absolute', inset: 0, display: drawn ? 'block' : 'none' }}
        />
      )}
    </div>
  )
}

/**
 * The trade, drawn: an offshore jacket platform with its crane, its deck
 * levels and the scaffold bay the paint crew works from, over a horizon.
 *
 * Inline SVG rather than an image file (Feedback Rv3, item 5, owner's choice
 * 2026-09-05). It costs no request, no cache entry and no decode on the one
 * screen every user loads first -- often on a site tether -- and it is drawn in
 * the app's own palette, so it cannot drift from the theme the way a flat
 * export would. Line work rather than a render: this sits behind a form, and a
 * photograph would fight it for attention.
 *
 * Purely decorative, so `aria-hidden`: everything it says is said by the line
 * of copy underneath it.
 */
function Platform() {
  const ink = palette.text
  const accent = palette.accent
  // The default coat template's own colours, on the bays of the scaffold: the
  // picture says what the product is for without a word of copy.
  const coats = ['#fadb14', '#bfbfbf', '#52c41a', '#1677ff']
  return (
    <svg
      viewBox="0 0 360 250"
      width="100%"
      // Fills LoginIllustration's box, centred in it: the box is the
      // animation's 3:2, this drawing is a little narrower.
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      aria-hidden
      focusable="false"
    >
      {/* Sea, in two bands: the near one darker, so the legs stand IN something. */}
      <rect x="0" y="196" width="360" height="30" fill="#CFE7E3" />
      <rect x="0" y="214" width="360" height="36" fill="#B6DCD6" />

      {/* Jacket: four battered legs, cross-braced at two levels. */}
      <g stroke={ink} strokeOpacity="0.42" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M74 150 L60 214 M104 150 L98 214 M150 150 L162 214 M180 150 L200 214" />
        <path d="M67 182 L190 182" strokeOpacity="0.22" />
        <path d="M74 150 L98 182 M104 150 L67 182 M150 150 L190 182 M180 150 L156 182" strokeOpacity="0.22" />
        {/* The middle span, so the frame reads as one jacket and not two legs. */}
        <path d="M104 150 L156 182 M150 150 L98 182" strokeOpacity="0.16" />
      </g>

      {/* Main deck slab, then the cellar deck under it. */}
      <rect x="52" y="136" width="150" height="14" rx="2" fill={accent} fillOpacity="0.18" stroke={accent} strokeWidth="1.8" />
      <rect x="62" y="124" width="130" height="12" rx="2" fill="#FFFFFF" stroke={ink} strokeOpacity="0.3" strokeWidth="1.6" />

      {/* Topside block and its windows. */}
      <rect x="84" y="92" width="72" height="32" rx="3" fill="#FFFFFF" stroke={ink} strokeOpacity="0.32" strokeWidth="1.6" />
      <g fill={ink} fillOpacity="0.2">
        <rect x="93" y="101" width="12" height="9" rx="1.5" />
        <rect x="111" y="101" width="12" height="9" rx="1.5" />
        <rect x="129" y="101" width="12" height="9" rx="1.5" />
      </g>

      {/* Crane: mast, jib, and a load on the hook. */}
      <g stroke={ink} strokeOpacity="0.42" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <path d="M74 124 L74 66 M74 66 L34 100" />
        <path d="M34 100 L34 122" strokeDasharray="3 4" strokeWidth="1.4" />
      </g>
      <rect x="27" y="122" width="15" height="11" rx="2" fill={accent} fillOpacity="0.75" />

      {/* Flare boom, out over the water on the far side. */}
      <g stroke={ink} strokeOpacity="0.3" strokeWidth="1.4" fill="none" strokeLinecap="round">
        <path d="M196 136 L246 74 M188 130 L240 68" />
        <path d="M196 136 L188 130 M209 120 L201 114 M222 104 L214 98 M235 88 L227 82" />
      </g>
      <path d="M246 74 q7 -9 3 -18 q9 8 6 18 z" fill="#F97316" fillOpacity="0.75" />

      {/*
        The scaffold the paint crew works from, drawn as an OPEN frame -- the
        standards, the ledgers and one diagonal brace -- with four of its bays
        already coated. That is the product in one picture: a grid over a
        structure, filled in as the work is done.
      */}
      <g stroke={accent} strokeOpacity="0.55" strokeWidth="1.4" fill="none">
        <rect x="244" y="128" width="84" height="72" />
        <path d="M272 128 L272 200 M300 128 L300 200 M244 152 L328 152 M244 176 L328 176" />
        {/* One brace corner to corner, as a real scaffold face is braced. It
            runs under the coated bays, so it shows only where work is left. */}
        <path d="M244 200 L328 128" strokeOpacity="0.28" />
      </g>
      <g strokeOpacity="0">
        <rect x="244.7" y="128.7" width="26.6" height="22.6" fill={coats[0]} fillOpacity="0.8" />
        <rect x="272.7" y="128.7" width="26.6" height="22.6" fill={coats[2]} fillOpacity="0.75" />
        <rect x="244.7" y="152.7" width="26.6" height="22.6" fill={coats[3]} fillOpacity="0.55" />
        <rect x="300.7" y="128.7" width="26.6" height="22.6" fill={coats[1]} fillOpacity="0.7" />
      </g>
      {/* Its feet, on the same deck level as the platform's legs. */}
      <path d="M256 200 L256 214 M316 200 L316 214 M240 214 L332 214" stroke={ink} strokeOpacity="0.28" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
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

  if (!wide) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 18px',
          background: palette.bgPage,
        }}
      >
        <LoginIllustration compact />
        {form}
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 48px',
          minWidth: 0,
        }}
      >
        {form}
      </div>
    </div>
  )
}
