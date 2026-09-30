import { Button, Tooltip, type ButtonProps } from 'antd'
import { ACTION_ICONS, type ActionVerb } from './actionIcons'

/**
 * A row or inline action (ACT-01): an icon-only button, square at the theme's
 * one control height (CTL-02), named by `label`, which is also its tooltip
 * unless `tooltip` says more (why it is disabled, what it does in full). The
 * button sits in a span so the tooltip still shows while it is disabled.
 * Page-level primary actions (Tạo …, Thêm …), the filter bar's Đặt lại and
 * Tìm, and dialog footers stay text buttons.
 */
export function IconAction({
  verb,
  label,
  tooltip,
  ...button
}: {
  verb: ActionVerb
  label: string
  tooltip?: string
} & Pick<ButtonProps, 'type' | 'danger' | 'disabled' | 'loading' | 'onClick' | 'aria-pressed'>) {
  const Icon = ACTION_ICONS[verb]
  return (
    <Tooltip title={tooltip ?? label}>
      <span style={{ display: 'inline-flex' }}>
        <Button {...button} aria-label={label} icon={<Icon aria-hidden />} />
      </span>
    </Tooltip>
  )
}
