import { FileExcelOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import type { PipingPanelProps } from './panelProps'

/**
 * Xuất báo cáo (spec §10), the icon action at the end of the Piping filter
 * bar (GS-09) for every role. A seam for now: the report is a later task of
 * the Piping plan, which builds it here against `PipingPanelProps` (on a
 * phone, GS-09 wants it in one `⋯` menu with icon and text).
 *
 * `panel` is null while the project's settings are read: the action keeps its
 * place in the bar, disabled, so the bar does not jump.
 */
export function PipingExportAction(_props: { panel: PipingPanelProps | null }) {
  return (
    <Tooltip title="Xuất báo cáo" mouseLeaveDelay={0}>
      <span style={{ display: 'inline-flex' }}>
        <Button aria-label="Xuất báo cáo" icon={<FileExcelOutlined aria-hidden />} disabled />
      </span>
    </Tooltip>
  )
}
