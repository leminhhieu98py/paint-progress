import { Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { palette, shadowCard } from '../theme'

/**
 * A wrong address for someone who is already signed in (QA F2).
 *
 * `NotFound` stays bare on purpose -- spec §7.3, obscurity for a stranger and
 * for the wrong role, where saying anything at all says a route exists. This
 * page is for the one case that hides nothing: an account already in, at a
 * path the app does not have (a typo, a stale bookmark), who was left on a
 * blank "404" with no way back. `home` is the role's own landing spot, so the
 * link never sends a foreman to the admin's screen.
 *
 * A real anchor with the real href, so it reads as a link and opens in a new
 * tab like one; the click itself stays in the router so the app is not
 * reloaded for a navigation it can make on its own.
 */
export function NotFoundPage({ home }: { home: string }) {
  const navigate = useNavigate()
  return (
    <div
      style={{
        maxWidth: 480,
        margin: '12vh auto',
        background: palette.bgContainer,
        border: `1px solid ${palette.borderCard}`,
        borderRadius: 14,
        boxShadow: shadowCard,
      }}
    >
      <EmptyState
        title="Không tìm thấy trang"
        description="Địa chỉ này không có trong ứng dụng. Kiểm tra lại đường dẫn, hoặc quay về trang chính."
        action={
          <Button
            type="primary"
            href={home}
            onClick={(e) => {
              e.preventDefault()
              navigate(home)
            }}
          >
            Về trang chính
          </Button>
        }
      />
    </div>
  )
}
