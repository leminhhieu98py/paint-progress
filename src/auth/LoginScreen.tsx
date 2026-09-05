import { Alert, Button, Form, Grid, Input } from 'antd'
import { useState } from 'react'
import { palette, shadowCard } from '../theme'
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
      <Platform />
      <h2
        style={{
          position: 'relative',
          margin: '28px 0 0',
          fontSize: 19,
          fontWeight: 600,
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
  return (
    <svg
      viewBox="0 0 320 220"
      width="100%"
      style={{ position: 'relative', maxWidth: 340, height: 'auto', display: 'block' }}
      aria-hidden
      focusable="false"
    >
      {/* Sea: two flat bands, the near one darker, so the legs read as standing IN something. */}
      <rect x="0" y="176" width="320" height="44" fill="#CFE7E3" />
      <rect x="0" y="196" width="320" height="24" fill="#B6DCD6" />

      {/* The jacket: four battered legs cross-braced, the way the real ones are. */}
      <g stroke={ink} strokeOpacity="0.5" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M96 130 L84 194 M150 130 L156 194 M120 130 L112 194 M176 130 L188 194" />
        <path d="M96 130 L176 130" strokeOpacity="0.28" />
        <path d="M90 160 L182 160" strokeOpacity="0.28" />
        <path d="M96 130 L112 160 M120 130 L90 160 M150 130 L182 160 M176 130 L156 160" strokeOpacity="0.28" />
        <path d="M90 160 L84 194 M112 160 L88 194 M182 160 L188 194 M156 160 L184 194" strokeOpacity="0.28" />
      </g>

      {/* Deck levels: the main deck, the cellar deck under it, and the topside block. */}
      <rect x="70" y="118" width="132" height="13" rx="2" fill={accent} fillOpacity="0.16" stroke={accent} strokeWidth="2" />
      <rect x="78" y="104" width="116" height="14" rx="2" fill="#FFFFFF" stroke={ink} strokeOpacity="0.35" strokeWidth="2" />
      <rect x="104" y="74" width="62" height="30" rx="3" fill="#FFFFFF" stroke={ink} strokeOpacity="0.35" strokeWidth="2" />
      <g fill={ink} fillOpacity="0.22">
        <rect x="112" y="82" width="10" height="8" rx="1" />
        <rect x="128" y="82" width="10" height="8" rx="1" />
        <rect x="144" y="82" width="10" height="8" rx="1" />
      </g>

      {/* Flare boom and crane: the two silhouettes that read as a platform at a glance. */}
      <g stroke={ink} strokeOpacity="0.45" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M196 118 L232 62" />
        <path d="M188 112 L226 58" strokeOpacity="0.25" />
        <path d="M196 118 L188 112 M206 106 L198 100 M216 94 L208 88 M226 82 L218 76" strokeOpacity="0.25" />
        <path d="M92 104 L92 58 M92 58 L54 88" />
        <path d="M54 88 L54 104" strokeDasharray="3 4" />
      </g>
      <circle cx="54" cy="108" r="4" fill={accent} />

      {/* The scaffold bay the crew paints from: the grid this whole product is about. */}
      <g stroke={accent} strokeWidth="2" fill="none">
        <rect x="212" y="128" width="66" height="48" rx="2" fill={accent} fillOpacity="0.1" />
        <path d="M234 128 L234 176 M256 128 L256 176 M212 144 L278 144 M212 160 L278 160" strokeOpacity="0.45" />
        {/* Two bays already coated, which is what a foreman would have ticked. */}
        <rect x="212" y="128" width="22" height="16" fill={accent} fillOpacity="0.55" strokeOpacity="0" />
        <rect x="234" y="144" width="22" height="16" fill={accent} fillOpacity="0.35" strokeOpacity="0" />
      </g>
      <path d="M245 176 L245 196 M212 196 L278 196" stroke={ink} strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" />
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
          fontSize: 21,
          fontWeight: 600,
          lineHeight: 1.25,
          letterSpacing: '-0.028em',
        }}
      >
        Đăng nhập
      </h1>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

      <Form<Values> layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
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
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 18px',
          background: palette.bgPage,
        }}
      >
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
