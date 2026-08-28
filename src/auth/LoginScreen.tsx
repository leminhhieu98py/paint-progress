import { Alert, Button, Form, Grid, Input } from 'antd'
import { useState } from 'react'
import { palette, shadowCard } from '../theme'
import { useAuth } from './AuthProvider'

interface Values {
  identifier: string
  password: string
}

/**
 * The hero panel beside the form.
 *
 * Wordless on purpose, and that is a DELIBERATE departure from the approved
 * prototype, which puts "Paint Progress" and a headline naming the product
 * here. This screen is the one thing a stranger who finds the URL can see, and
 * the app is already built not to tell them anything: index.html carries a "—"
 * title and noindex, and the sign-in error refuses to distinguish "no such
 * user" from "wrong password" so it cannot confirm which usernames exist. A
 * hero that names the product and the trade undoes all three.
 *
 * The five bars are the stage palette, so the screen still belongs to this
 * product visually. Five coloured rectangles identify nothing.
 *
 * Exported so a test can assert the wordlessness directly. The breakpoint hook
 * reports every screen false under jsdom, so the wide layout -- and this panel
 * with it -- never renders through LoginScreen in a test.
 */
export function Hero() {
  const bars: [string, number][] = [
    ['#fadb14', 96],
    ['#bfbfbf', 70],
    ['#52c41a', 126],
    ['#1677ff', 52],
    ['#722ed1', 34],
  ]
  return (
    <div
      aria-hidden
      style={{
        background: 'linear-gradient(#F6FBFA, #EDF5F4)',
        padding: '0 48px',
        display: 'flex',
        alignItems: 'center',
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
          background: 'rgba(10, 129, 117, 0.09)',
        }}
      />
      <div style={{ position: 'relative', display: 'flex', gap: 7, alignItems: 'flex-end' }}>
        {bars.map(([color, height]) => (
          <div key={color} style={{ width: 46, height, borderRadius: 8, background: color }} />
        ))}
      </div>
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
      <span
        style={{
          display: 'inline-block',
          width: 28,
          height: 28,
          borderRadius: 9,
          background: palette.accent,
        }}
      />
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
