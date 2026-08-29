import { palette } from '../theme'

/**
 * The one dialog shape this app has, applied through antd's `styles` slots.
 *
 * antd's default Modal pads the whole sheet uniformly and leaves the footer
 * floating inside that padding, so a dialog's actions sat in the same visual
 * block as its content. The design separates the three: a header that owns the
 * title, a body that owns the content, and a tinted strip along the bottom edge
 * that owns the actions. The strip is what makes "what happens next" findable
 * without reading -- it is in the same place, in the same colour, in every
 * dialog in the product.
 *
 * `content: { padding: 0 }` is load-bearing: the three slots below each carry
 * their own padding, and leaving antd's on as well would double it.
 */
export const modalStyles = {
  content: { padding: 0 },
  header: { padding: '20px 24px 0', margin: 0 },
  body: { padding: '16px 24px 20px' },
  footer: {
    margin: 0,
    padding: '16px 24px',
    background: palette.bgSubtle,
    borderTop: `1px solid ${palette.borderSplit}`,
    display: 'flex',
    gap: 9,
    justifyContent: 'flex-end',
  },
} as const

/**
 * Help text under a field, in the dialog's own measure.
 *
 * antd's `extra` renders at the ambient 13px with no leading of its own, which
 * put a two-line consequence ("Mật khẩu cũ ngừng hiệu lực ngay...") hard
 * against the input above it and made the sentence read as part of the field.
 */
export const fieldHelpStyle = {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 1.5,
  color: palette.textTertiary,
} as const
