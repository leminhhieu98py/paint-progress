import { LogoutOutlined, RightOutlined } from '@ant-design/icons'
import { Alert, Button, Layout, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { StatusPill } from '../../components/StatusPill'
import { APP_BASE_PATH, LOGIN_PATH } from '../../config'
import { listProjectCards, type ProjectCard } from '../../lib/projectsApi'
import { palette, shadowCard } from '../../theme'

/**
 * Where a viewer lands (Feedback Rv6 item 7, RV6-23).
 *
 * 0034 lets the `viewer` role read every project and leaves it with no
 * `project_members` row, so the 0028 landing -- the GS screen of the first
 * membership -- has nothing to go on. This page is the choice the boss makes
 * instead: one card per project, by name, each a link to that project's GS
 * screen. One project is not a choice, so it redirects straight there.
 *
 * Read-only and nothing else: the GS screen this leads to already says
 * "Chỉ xem" and offers no write control, and the header here is the same
 * shape as that screen's -- who is signed in, and logout.
 */
export function ProjectPickerScreen() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const [cards, setCards] = useState<ProjectCard[] | 'loading' | 'error'>('loading')
  const [confirmingOut, setConfirmingOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    listProjectCards()
      .then((rows) => {
        if (!cancelled) setCards(rows)
      })
      .catch(() => {
        if (!cancelled) setCards('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (cards === 'loading') {
    return <Spin style={{ display: 'block', margin: '25vh auto' }} />
  }
  if (cards === 'error') {
    return (
      <div style={{ maxWidth: 360, margin: '25vh auto' }}>
        <Alert
          type="error"
          message="Không tải được danh sách dự án"
          description="Kiểm tra kết nối mạng rồi thử lại."
        />
      </div>
    )
  }
  if (cards.length === 1) {
    return <Navigate to={`${APP_BASE_PATH}/gs/${cards[0].id}`} replace />
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          background: palette.bgContainer,
          borderBottom: `1px solid ${palette.borderCard}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingInline: 16,
          height: 'auto',
          lineHeight: 'normal',
          paddingBlock: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 18 }}>Chọn dự án</div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div style={{ fontWeight: 600, lineHeight: 1.25 }}>{profile?.fullName}</div>
          <span style={{ fontSize: 11, color: palette.textTertiary }}>{profile?.username}</span>
        </div>
        <StatusPill tone="off">Chỉ xem</StatusPill>
        {/* Spec §8.1: no account UI. Logout only, as on the GS screen. */}
        <Button
          aria-label="Đăng xuất"
          icon={<LogoutOutlined />}
          onClick={() => setConfirmingOut(true)}
        />
      </Layout.Header>

      <Layout.Content style={{ padding: 16, background: palette.bgApp }}>
        {cards.length === 0 ? (
          <div style={{ maxWidth: 360, margin: '20vh auto' }}>
            <Alert
              type="info"
              message="Chưa có dự án nào"
              description="Quản trị viên chưa tạo dự án nào."
            />
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
              maxWidth: 1100,
              margin: '0 auto',
            }}
          >
            {cards.map((p) => (
              <Link
                key={p.id}
                to={`${APP_BASE_PATH}/gs/${p.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '16px 18px',
                  background: palette.bgContainer,
                  border: `1px solid ${palette.borderCard}`,
                  borderRadius: 14,
                  boxShadow: shadowCard,
                  color: palette.text,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 17,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, color: palette.textTertiary }}>
                    <span style={{ fontWeight: 600, color: palette.textSecondary }}>{p.code}</span>
                    {' · '}
                    {p.deckCount} sàn
                  </div>
                </div>
                <RightOutlined aria-hidden style={{ color: palette.textQuaternary }} />
              </Link>
            ))}
          </div>
        )}
      </Layout.Content>

      <ConsequenceModal
        open={confirmingOut}
        tag="Xác nhận"
        title="Đăng xuất?"
        description="Phiên làm việc hiện tại sẽ kết thúc:"
        items={[{ label: profile?.fullName ?? '', meta: profile?.username ?? '' }]}
        consequence="Muốn xem tiếp thì phải đăng nhập lại bằng mật khẩu quản trị viên đã giao."
        okText="Vẫn đăng xuất"
        onCancel={() => setConfirmingOut(false)}
        onOk={() => void signOut().then(() => navigate(LOGIN_PATH, { replace: true }))}
      />
    </Layout>
  )
}
