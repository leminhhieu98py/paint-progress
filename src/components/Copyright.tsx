import type { ReactNode } from 'react'
import { palette, space, type } from '../theme'

/**
 * The customer's copyright line, which every screen ends with (Feedback Rv7,
 * RV7-2): one caption line in the secondary colour, right aligned.
 *
 * In the page's flow, never fixed over content (owner). A shell that is a
 * flex column takes it to the bottom of a short page with the auto top
 * margin; on a long page it simply follows the content. `paddingInline` lines
 * its right edge up with the shell's own content.
 *
 * The developer's credit is not here on purpose: it lives in index.html's
 * author meta and package.json only, nothing on screen (owner 2026-10-01).
 */
export function Copyright({ paddingInline = space.lg }: { paddingInline?: number }) {
  return (
    <footer
      style={{
        marginTop: 'auto',
        paddingBlock: space.md,
        paddingInline,
        textAlign: 'right',
        ...type.caption,
        lineHeight: 1.5,
        color: palette.textSecondary,
      }}
    >
      Bản quyền © 2026 Đoàn Linh – XDVTH
    </footer>
  )
}

/**
 * A screen with no shell of its own (a not-found page, a failed read, a
 * GS with no project): its content, then the copyright line at the bottom of
 * the page (RV7-2). The content keeps a block box, so it lays out as it would
 * without the line.
 */
export function CopyrightPage({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div>{children}</div>
      <Copyright />
    </div>
  )
}
