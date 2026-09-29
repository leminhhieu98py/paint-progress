import { RightOutlined } from '@ant-design/icons'
import { Alert, Layout, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { APP_BASE_PATH } from '../../config'
import { listProjectCards, type ProjectCard } from '../../lib/projectsApi'
import { TypeScaleProvider } from '../../components/typeScale'
import { fieldType, palette, shadowCard, space } from '../../theme'
import { FieldAccountTrigger } from './FieldAccountTrigger'
import { seedProjectList } from './fieldProjects'

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
 * "Visitor" and offers no write control, and the header here carries that
 * screen's account trigger and menu -- who is signed in, and logout.
 */
export function ProjectPickerScreen() {
  const [cards, setCards] = useState<ProjectCard[] | 'loading' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    listProjectCards()
      .then((rows) => {
        if (cancelled) return
        setCards(rows)
        // The freshest list of this session: the field header's switch takes
        // it, so a project created since the header last read is in it (M-1b).
        seedProjectList(rows)
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
    // The field's type scale, as under FieldLayout (GS-10): the logout dialog is shared.
    <TypeScaleProvider value={fieldType}>
      <Layout style={{ minHeight: '100vh' }}>
        <Layout.Header
          style={{
            background: palette.bgContainer,
            borderBottom: `1px solid ${palette.borderCard}`,
            display: 'flex',
            alignItems: 'center',
            gap: space.md,
            paddingInline: space.lg,
            height: 'auto',
            lineHeight: 'normal',
            paddingBlock: 10,
          }}
        >
          <h1 style={{ flex: 1, minWidth: 0, margin: 0, ...fieldType.pageTitle }}>Chọn dự án</h1>
          {/*
            The project pages' account trigger and menu (GS-06, M-4): who is
            signed in, Visitor, and Đăng xuất behind its confirm.
          */}
          <FieldAccountTrigger
            consequence="Muốn xem tiếp thì phải đăng nhập lại bằng mật khẩu quản trị viên đã giao."
          />
        </Layout.Header>

        <Layout.Content style={{ padding: space.lg, background: palette.bgApp }}>
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
                gap: space.md,
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
                    gap: space.md,
                    padding: `${space.lg}px ${space.xl}px`,
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
                        ...fieldType.cardTitle,
                        lineHeight: 1.3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ marginTop: space.xs, ...fieldType.caption, color: palette.textTertiary }}>
                      <span style={{ color: palette.textSecondary }}>{p.code}</span>
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

      </Layout>
    </TypeScaleProvider>
  )
}
