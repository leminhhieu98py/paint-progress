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
  // The default coat template's own colours, on the bays of the scaffold: the
  // picture says what the product is for without a word of copy.
  const coats = ['#fadb14', '#bfbfbf', '#52c41a', '#1677ff']
  return (
    <svg
      viewBox="0 0 360 250"
      width="100%"
      style={{ position: 'relative', maxWidth: 372, height: 'auto', display: 'block' }}
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
