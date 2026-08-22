import { Alert, Button } from 'antd'
import { Component, type ReactNode } from 'react'

interface State {
  hasError: boolean
}

/**
 * Catches a render-time throw anywhere below the routed screens.
 *
 * The concrete trigger this exists for: a deploy rotates the hashed chunk
 * names while an admin's tab is still open, with one of the four lazy admin
 * chunks (AdminLayout, ProjectsScreen, DecksScreen, UsersScreen -- see
 * routes.tsx) not yet loaded. The next navigation's dynamic import() 404s;
 * Suspense has no mechanism for catching a REJECTED import (it only suspends
 * a pending one), so with nothing here React unmounts the whole tree -- a
 * blank white page, no message, no way back short of knowing to hit F5.
 * Every screen below main.tsx is one failure domain, and this is the one
 * boundary around all of them.
 *
 * componentDidCatch has no hook equivalent, so this is the one place in the
 * app a class component is correct -- erasableSyntaxOnly forbids parameter
 * properties in a constructor, not classes themselves, and this uses neither
 * a constructor nor parameter properties.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    // The only surface this failure has once the tree below has already
    // unmounted -- there is no admin-visible substitute for this that would
    // not risk leaking internals into the UI itself.
    console.error('Unhandled error below the routed screens:', error)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: 360, margin: '25vh auto' }}>
          <Alert
            type="error"
            message="Đã xảy ra lỗi"
            description="Không thể tải màn hình này. Ứng dụng có thể vừa được cập nhật. Tải lại trang để tiếp tục."
            action={
              <Button size="small" onClick={() => window.location.reload()}>
                Tải lại trang
              </Button>
            }
          />
        </div>
      )
    }
    return this.props.children
  }
}
