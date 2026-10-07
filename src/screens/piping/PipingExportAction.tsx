import { FileExcelOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import type { PipingPanelProps } from './panelProps'

/**
 * Xuất báo cáo (spec §10), the icon action at the end of the Piping filter
 * bar (GS-09) for every role. A seam for now: the report is a later task of
 * the Piping plan, which builds it here against `PipingPanelProps`.
 */
export function PipingExportAction(_props: PipingPanelProps) {
  return (
    <Tooltip title="Xuất báo cáo" mouseLeaveDelay={0}>
      <span style={{ display: 'inline-flex' }}>
        <Button aria-label="Xuất báo cáo" icon={<FileExcelOutlined aria-hidden />} disabled />
      </span>
    </Tooltip>
  )
}
