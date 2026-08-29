import { render, type RenderOptions } from '@testing-library/react'
import { App as AntApp } from 'antd'
import type { ReactElement } from 'react'

/**
 * Renders a screen inside antd's `<App>`, the way the real tree does.
 *
 * Screens raise their toasts through `App.useApp()`. Outside the provider antd
 * hands back a no-op instance and logs a warning, so a toast assertion written
 * against a bare `render` fails for a reason that has nothing to do with the
 * screen -- or worse, a regression that drops a toast still passes, because
 * there was never a live message API to drop it from.
 */
export function renderApp(ui: ReactElement, options?: RenderOptions) {
  return render(<AntApp>{ui}</AntApp>, options)
}
