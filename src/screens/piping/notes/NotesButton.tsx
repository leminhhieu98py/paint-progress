import { Badge } from 'antd'
import { IconAction } from '../../../components/IconAction'
import { palette } from '../../../theme'
import { formatQty } from '../pipingFormat'

/**
 * A note icon (ACT-01), its count on a badge and in its name; plain while the
 * target has none. While the notes could not be read (`failed`) it says so
 * instead of a count: unread is not "no notes".
 */
export function NotesButton({ count, failed = false, onClick }: { count: number; failed?: boolean; onClick: () => void }) {
  if (failed) {
    return (
      <Badge count="!" size="small" color={palette.warning}>
        <IconAction verb="notes" label="Ghi chú (không tải được)" onClick={onClick} />
      </Badge>
    )
  }
  return (
    <Badge count={count} size="small" color={palette.accent}>
      <IconAction
        verb="notes"
        label={count > 0 ? `Ghi chú (${formatQty(count)})` : 'Ghi chú'}
        type={count > 0 ? 'default' : 'text'}
        onClick={onClick}
      />
    </Badge>
  )
}
