import { Alert, Table } from 'antd'
import { StatusPill, type StatusTone } from '../../../components/StatusPill'
import { useTablePagination } from '../../../components/tablePagination'
import type { ImportKind } from '../../../domain/piping/types'
import { formatDateTimeVN, MISSING } from '../../../lib/format'
import { listImportLog, type PipingImportLogRow } from '../../../lib/pipingApi'
import { useProjectList } from './useProjectList'

/** What each import is called on screen, in the file's own English (Q27). */
const KINDS: Record<ImportKind, { label: string; tone: StatusTone }> = {
  reinstatement_plan: { label: 'Reinstatement Plan', tone: 'accent' },
  manpower_plan: { label: 'Manpower Plan', tone: 'info' },
  spool_plan: { label: 'Insulation Plan', tone: 'ok' },
  spool_actual: { label: 'Insulation Actual', tone: 'slate' },
}

const COUNT = new Intl.NumberFormat('vi-VN')

/** Lịch sử import (spec §8): every confirmed import of the project, newest first. */
export function ImportLogSection({ projectId }: { projectId: string }) {
  const list = useProjectList(projectId, listImportLog)
  const rows = list.rows ?? []
  const pagination = useTablePagination(rows.length, projectId)

  if (list.error) return <Alert type="error" showIcon message="Không tải được lịch sử import" description={list.error} />

  return (
    <Table<PipingImportLogRow>
      rowKey="id"
      loading={list.rows === null}
      dataSource={rows}
      pagination={pagination}
      locale={{ emptyText: 'Chưa có lần import nào' }}
      columns={[
        {
          title: 'Loại',
          dataIndex: 'kind',
          align: 'center',
          render: (kind: ImportKind) => <StatusPill tone={KINDS[kind].tone}>{KINDS[kind].label}</StatusPill>,
        },
        { title: 'Tệp', dataIndex: 'fileName', render: (v: string) => v || MISSING },
        { title: 'Số dòng', dataIndex: 'rowCount', align: 'center', render: (v: number) => COUNT.format(v) },
        { title: 'Người import', dataIndex: 'importedByName', render: (v: string | null) => v ?? MISSING },
        { title: 'Thời gian', dataIndex: 'importedAt', align: 'center', render: (v: string | null) => formatDateTimeVN(v) || MISSING },
      ]}
    />
  )
}
