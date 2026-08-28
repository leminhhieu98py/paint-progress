import {
  BuildOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Button, Layout, Menu, Tooltip } from 'antd'
import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { APP_BASE_PATH, LOGIN_PATH } from '../../config'
import { useAuth } from '../../auth/AuthProvider'
import { initialsOf } from '../../lib/initials'
import { palette } from '../../theme'

const items = [
  { key: 'projects', label: 'Dự án', icon: <FolderOpenOutlined /> },
  { key: 'decks', label: 'Sàn', icon: <BuildOutlined /> },
  { key: 'users', label: 'Người dùng', icon: <TeamOutlined /> },
]

const OPEN_WIDTH = 240
const COLLAPSED_WIDTH = 66

export function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  /*
    Matched on a path SEGMENT, not on the end of the string. A deck's own
    address is /admin/decks/:id, and an `endsWith` match leaves the entire
    sidebar unselected on the screen the admin spends the most time in --
    which reads as "you are nowhere".
  */
  const selected =
    items.find((i) => pathname.split('/').includes(i.key))?.key ?? 'projects'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        theme="light"
        width={OPEN_WIDTH}
        collapsedWidth={COLLAPSED_WIDTH}
        collapsed={collapsed}
        style={{
          borderRight: `1px solid ${palette.borderCard}`,
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div
            style={
              collapsed
                ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 11, padding: '18px 0 14px' }
                : { display: 'flex', alignItems: 'center', gap: 11, padding: '20px 16px 16px' }
            }
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: palette.accent,
                flex: 'none',
              }}
            />
            {!collapsed && (
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                Paint Progress
              </span>
            )}
            <Button
              type="text"
              size="small"
              aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((v) => !v)}
            />
          </div>

          <Menu
            mode="inline"
            inlineCollapsed={collapsed}
            selectedKeys={[selected]}
            style={{ borderInlineEnd: 0, padding: collapsed ? '4px 0' : '4px 12px' }}
            items={items.map((i) => ({
              key: i.key,
              icon: i.icon,
              label: <Link to={`${APP_BASE_PATH}/admin/${i.key}`}>{i.label}</Link>,
            }))}
          />

          <div
            style={
              collapsed
                ? {
                    marginTop: 'auto',
                    padding: '14px 0 16px',
                    borderTop: `1px solid ${palette.borderCard}`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                  }
                : {
                    marginTop: 'auto',
                    padding: '14px 16px 16px',
                    borderTop: `1px solid ${palette.borderCard}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                  }
            }
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: palette.accent,
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
                lineHeight: '34px',
                textAlign: 'center',
                flex: 'none',
              }}
            >
              {initialsOf(profile?.fullName ?? '')}
            </span>
            {!collapsed && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {profile?.fullName}
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.3, color: palette.textTertiary, marginTop: 2 }}>
                  Quản trị viên
                </div>
              </div>
            )}
            {/*
              Navigated, not merely signed out. Without this the session goes
              but the URL stays on an admin route, so the login form appears
              under a path the person is no longer allowed on -- and a refresh
              puts them straight back there.
            */}
            <Tooltip title="Đăng xuất" placement="right">
              <Button
                aria-label="Đăng xuất"
                icon={<LogoutOutlined />}
                onClick={() =>
                  void signOut().then(() => navigate(LOGIN_PATH, { replace: true }))
                }
              />
            </Tooltip>
          </div>
        </div>
      </Layout.Sider>

      {/*
        No padding here on purpose. Every admin screen opens with a full-bleed
        PageHeader -- white, with its own bottom rule running the full width --
        and an inset content area would leave that rule floating short of both
        edges. The screens pad their own bodies with PageBody.
      */}
      <Layout.Content style={{ minWidth: 0, background: palette.bgApp }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  )
}
