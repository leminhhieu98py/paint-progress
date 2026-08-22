/**
 * Deliberately bare. No branding, no redirect, no hint that an app lives here.
 * Spec §7.3 — obscurity only; Auth and RLS carry the real access control.
 */
export function NotFound() {
  return <div style={{ font: '13px/1.4 monospace', padding: 8 }}>404</div>
}
