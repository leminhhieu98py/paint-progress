import { QuestionCircleOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { palette, space } from '../theme'

/**
 * The one way this app explains a label (CPY-02): a small `(?)` right after
 * it, the explanation in a tooltip.
 *
 * Guidance a reader needs once -- how a number is computed, what a legend
 * means, a limit on the data -- lives here rather than as a caption read on
 * every visit. It opens on hover and on keyboard focus, and the icon is named
 * by the text itself, so a screen reader gets the explanation without the
 * tooltip.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip title={text} trigger={['hover', 'focus']}>
      <QuestionCircleOutlined
        tabIndex={0}
        aria-label={text}
        style={{
          color: palette.textTertiary,
          fontSize: '0.92em',
          marginInlineStart: space.xs,
          cursor: 'help',
          verticalAlign: 'middle',
        }}
      />
    </Tooltip>
  )
}
