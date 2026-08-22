import { Alert, Button, Card, Form, Input } from 'antd'
import { useState } from 'react'
import { useAuth } from './AuthProvider'

interface Values {
  identifier: string
  password: string
}

export function LoginScreen() {
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFinish = async ({ identifier, password }: Values) => {
    setBusy(true)
    setError(null)
    try {
      const { error: signInError } = await signIn(identifier, password)
      if (signInError) {
        // Never echo the provider's message: it distinguishes "no such user"
        // from "wrong password" and would confirm which usernames exist.
        setError('Tên đăng nhập hoặc mật khẩu không đúng')
      }
    } catch {
      setError('Không kết nối được. Kiểm tra mạng rồi thử lại.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <Card style={{ width: 340 }}>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
        <Form<Values> layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="identifier"
            label="Tên đăng nhập"
            rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}
          >
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mật khẩu"
            rules={[{ required: true, message: 'Nhập mật khẩu' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy}>
            Đăng nhập
          </Button>
        </Form>
      </Card>
    </div>
  )
}
