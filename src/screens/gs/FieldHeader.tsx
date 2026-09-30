import { AimOutlined, AppstoreOutlined, LineChartOutlined } from '@ant-design/icons'
import { Layout } from 'antd'
import type { CSSProperties } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { APP_BASE_PATH } from '../../config'
import { fieldType, palette, space, type } from '../../theme'
import { FieldAccountTrigger } from './FieldAccountTrigger'
import {
  FIELD_SAFE_AREA_BOTTOM, FIELD_SECTIONS, FIELD_TAB_BAR_SPACE, fieldSectionOf, useFieldPhone, type FieldSection,
} from './fieldSections'

/** One fixed height on all three routes: a 48px field control and 8px either side. */
const HEADER_HEIGHT = 64

/**
 * The bottom bar's icons (GS-06): the drawing's grid of bays, the productivity
 * curve, the KPI target. Beside a label, never alone.
 */
const SECTION_ICONS: Record<FieldSection['label'], typeof AppstoreOutlined> = {
  'Sàn': AppstoreOutlined,
  'Năng suất': LineChartOutlined,
  'KPI': AimOutlined,
}

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

/**
 * The one header of the field screens (GS-01, GS-06): Sàn, Năng suất and KPI
 * of one project, for the foreman and the viewer alike, and the account.
 *
 * Left, the three pages as router links, the active one read from the route;
 * they are the only way between the pages (GS-02), so there is no back button
 * anywhere. Right, the account trigger -- avatar, full name, `Visitor` for a
 * viewer -- whose menu holds who is signed in and Đăng xuất, behind the same
 * confirm as before. The project is not here: it is the first control of each
 * page's filter bar (GS-07).
 *
 * On a phone (< 768) the top bar holds the page's name and the trigger,
 * folded to the avatar and named for who is signed in (the name, the login
 * and a viewer's `Visitor` are in its menu); the tabs move to a bar fixed to
 * the bottom of the screen, icon over label.
 */
export function FieldHeader({ projectId }: { projectId: string }) {
  const { pathname } = useLocation()
  const phone = useFieldPhone()

  const base = `${APP_BASE_PATH}/gs/${projectId}`
  const current = fieldSectionOf(pathname)

  const tabs = FIELD_SECTIONS.map((s) => {
    const active = s === current
    const Icon = SECTION_ICONS[s.label]
    return (
      <Link
        key={s.label}
        to={`${base}${s.suffix}`}
        aria-current={active ? 'page' : undefined}
        style={phone
          ? {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            // One weight under the icon: the colour and the top rule mark the page.
            ...type.caption,
            color: active ? palette.accent : palette.textSecondary,
            borderTop: `2px solid ${active ? palette.accent : 'transparent'}`,
          }
          : {
            display: 'flex',
            alignItems: 'center',
            paddingInline: space.md,
            whiteSpace: 'nowrap',
            textDecoration: 'none',
            ...(active ? fieldType.bodyStrong : fieldType.body),
            color: active ? palette.accent : palette.textSecondary,
            borderBottom: `2px solid ${active ? palette.accent : 'transparent'}`,
            borderTop: '2px solid transparent',
          }}
      >
        {phone && <Icon aria-hidden style={{ fontSize: 20 }} />}
        {s.label}
      </Link>
    )
  })

  return (
    <>
      <Layout.Header
        style={{
          background: palette.bgContainer,
          borderBottom: `1px solid ${palette.borderCard}`,
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          gap: phone ? space.sm : space.md,
          paddingInline: phone ? space.md : space.lg,
          height: HEADER_HEIGHT,
          lineHeight: 'normal',
          overflow: 'hidden',
        }}
      >
        {phone ? (
          // The page's name where the tabs were: on a phone the tabs are at the bottom.
          <h1 style={{ ...type.pageTitle, ...ellipsis, margin: 0, minWidth: 0, color: palette.text }}>
            {(current ?? FIELD_SECTIONS[0]).label}
          </h1>
        ) : (
          <nav aria-label="Điều hướng" style={{ display: 'flex', alignSelf: 'stretch', flex: 'none' }}>
            {tabs}
          </nav>
        )}

        <FieldAccountTrigger
          consequences={['Ghi tiếp tiến độ cần đăng nhập lại bằng mật khẩu quản trị viên đã giao']}
        />
      </Layout.Header>

      {phone && (
        /*
          The tabs under the thumb (GS-06): a fixed bar at the bottom, clear of
          the home indicator. FieldLayout pads the page by the same space.
        */
        <nav
          aria-label="Điều hướng"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
            display: 'flex',
            height: FIELD_TAB_BAR_SPACE,
            // calc() round the inset, so a style engine that drops a bare env()
            // (jsdom) keeps it as the browser does.
            paddingBottom: `calc(${FIELD_SAFE_AREA_BOTTOM})`,
            boxSizing: 'border-box',
            background: palette.bgContainer,
            borderTop: `1px solid ${palette.borderCard}`,
          }}
        >
          {tabs}
        </nav>
      )}
    </>
  )
}
