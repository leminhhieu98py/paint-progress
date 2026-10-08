import { Alert, Checkbox, Table } from 'antd'
import { KeyFacts } from '../../../components/KeyFacts'
import { StatusPill } from '../../../components/StatusPill'
import { tablePagination } from '../../../components/tablePagination'
import { useTypeScale } from '../../../components/typeScale'
import { MILESTONE_LABEL } from '../../../domain/piping/cam'
import type { ImportIssue } from '../../../domain/piping/imports'
import type { DayKey, Milestone } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { palette, space } from '../../../theme'
import { capList } from '../listCap'
import { formatQty } from '../pipingFormat'
import type { ActualOverwriteLine, ActualPreview, ActualSkipLine } from './actualPreview'

/**
 * What saving the actual dates does, before it is done (spec §6.3): how many
 * spools are saved, which stored dates are replaced (old -> new, only once
 * the box is ticked), which spools are skipped and why, how many already
 * hold the date. One body for Cập nhật Actual and Nhập Actual.
 */
export function ActualPreviewBody({ preview, overwrite, onOverwrite, warnings = [], error }: {
  preview: ActualPreview
  overwrite: boolean
  onOverwrite: (value: boolean) => void
  /** Notes that do not block, e.g. a SpoolNo matching several spools (R-11). */
  warnings?: ImportIssue[]
  error?: string | null
}) {
  const type = useTypeScale()
  const dateCell = (d: DayKey | null) => (d === null ? MISSING : formatDayMonthYear(d))
  const notes = capList(warnings)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      {error && <Alert type="error" showIcon message={error} />}
      <KeyFacts
        facts={[
          { value: formatQty(preview.save), label: 'spool lưu' },
          { value: formatQty(preview.overwriteSpools), label: 'spool ghi đè', tone: preview.overwriteSpools > 0 ? 'warning' : 'neutral' },
          { value: formatQty(preview.skipped.length), label: 'spool bỏ qua', tone: preview.skipped.length > 0 ? 'warning' : 'neutral' },
          { value: formatQty(preview.unchanged), label: 'spool không đổi' },
        ]}
      />
      {warnings.length > 0 && (
        <Alert
          type="info"
          showIcon
          message={(
            <ul style={{ margin: 0, paddingInlineStart: space.lg }}>
              {notes.shown.map((w, i) => (
                <li key={i}>{w.row === null ? w.message : `Dòng ${formatQty(w.row)}: ${w.message}`}</li>
              ))}
              {notes.more > 0 && <li>{`và ${formatQty(notes.more)} cảnh báo khác`}</li>}
            </ul>
          )}
        />
      )}
      {preview.skipped.length > 0 && (
        <section aria-label="Spool bỏ qua" style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <span style={{ ...type.bodyStrong }}>Bỏ qua, không lưu</span>
          <Table<ActualSkipLine>
            rowKey="key"
            dataSource={preview.skipped}
            pagination={tablePagination(preview.skipped.length)}
            columns={[
              { title: 'SpoolNo', dataIndex: 'spoolNo' },
              { title: 'Lý do', dataIndex: 'reason' },
            ]}
          />
        </section>
      )}
      {preview.overwriteSpools > 0 && (
        <section aria-label="Ngày Actual bị ghi đè" style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <span style={{ ...type.bodyStrong }}>Ghi đè ngày Actual đã có</span>
          {preview.overwrites.length > 0 && (
            <Table<ActualOverwriteLine>
              rowKey="key"
              dataSource={preview.overwrites}
              pagination={tablePagination(preview.overwrites.length)}
              columns={[
                { title: 'SpoolNo', dataIndex: 'spoolNo' },
                {
                  title: 'Mốc',
                  dataIndex: 'milestone',
                  align: 'center',
                  render: (m: Milestone) => <StatusPill tone="slate">{MILESTONE_LABEL[m]}</StatusPill>,
                },
                { title: 'Cũ', dataIndex: 'from', align: 'center', render: dateCell },
                { title: 'Mới', dataIndex: 'to', align: 'center', render: dateCell },
              ]}
            />
          )}
          <Checkbox checked={overwrite} onChange={(e) => onOverwrite(e.target.checked)}>
            <span style={{ color: palette.warning }}>
              {`Ghi đè ngày Actual của ${formatQty(preview.overwriteSpools)} spool`}
            </span>
          </Checkbox>
        </section>
      )}
    </div>
  )
}
