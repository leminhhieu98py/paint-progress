import { Alert, Button, Form, Grid, Input } from 'antd'
import { useState } from 'react'
import { palette, shadowCard } from '../theme'
import { useAuth } from './AuthProvider'

interface Values {
  identifier: string
  password: string
}

/**
 * The hero panel beside the form: the five stage colours, and what the product
 * does.
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
  // Coat 2's bar carries the prototype's own hairline texture. It is
  // decoration here, not data -- a flat #bfbfbf between two saturated bars
  // reads as a gap rather than as a bar.
  const bars: [string, number][] = [
    ['#fadb14', 96],
    ['repeating-linear-gradient(90deg,#bfbfbf 0 5px,#949494 5px 6px)', 70],
    ['#52c41a', 126],
    ['#1677ff', 52],
    ['#722ed1', 34],
  ]
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
      <div style={{ position: 'relative', display: 'flex', gap: 7, alignItems: 'flex-end' }}>
        {bars.map(([background, height]) => (
          <div key={background} style={{ width: 46, height, borderRadius: 8, background }} />
        ))}
      </div>
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
        Tiến độ sơn theo từng ô, ngay trên bản vẽ.
      </h2>
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
        <span style={{ fontSize: 13, fontWeight: 600 }}>Paint Progress</span>
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
