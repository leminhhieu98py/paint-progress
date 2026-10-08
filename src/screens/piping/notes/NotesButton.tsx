import { Badge } from 'antd'
import { IconAction } from '../../../components/IconAction'
import { palette } from '../../../theme'
import { formatQty } from '../pipingFormat'

/** A note icon (ACT-01), its count on a badge and in its name; plain while the target has none. */
export function NotesButton({ count, onClick }: { count: number; onClick: () => void }) {
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
