import { Button, Layout, Menu } from 'antd'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { APP_BASE_PATH } from '../../config'
import { useAuth } from '../../auth/AuthProvider'

const items = [
  { key: 'projects', label: 'Dự án' },
  { key: 'decks', label: 'Sàn' },
  { key: 'users', label: 'Người dùng' },
]

export function AdminLayout() {
  const { profile, signOut } = useAuth()
  const { pathname } = useLocation()
  const selected = items.find((i) => pathname.endsWith(`/${i.key}`))?.key ?? 'projects'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="light" width={200}>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={items.map((i) => ({
            key: i.key,
            label: <Link to={`${APP_BASE_PATH}/admin/${i.key}`}>{i.label}</Link>,
          }))}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            background: '#fff',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>{profile?.fullName}</span>
          <Button onClick={() => void signOut()}>Đăng xuất</Button>
        </Layout.Header>
        <Layout.Content style={{ padding: 24 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
