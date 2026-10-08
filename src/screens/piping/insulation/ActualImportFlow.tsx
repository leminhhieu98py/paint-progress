import { UploadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Modal, Table, Upload } from 'antd'
import { useRef, useState } from 'react'
import { IconAction } from '../../../components/IconAction'
import { modalProps } from '../../../components/modalChrome'
import { tablePagination } from '../../../components/tablePagination'
import { useTypeScale } from '../../../components/typeScale'
import type { ActualChange } from '../../../domain/piping/cam'
import { parseSpoolActual, resolveSpoolActualImport, type ImportIssue } from '../../../domain/piping/imports'
import type { DayKey } from '../../../domain/piping/types'
import { MISSING } from '../../../lib/format'
import { buildSpoolActualTemplate, templateFileName } from '../../../lib/piping/templates'
import { readWorkbookRows } from '../../../lib/piping/xlsx'
import { flattenActualUpdates, listSpools, setSpoolActuals } from '../../../lib/pipingApi'
import { downloadWorkbook } from '../../../lib/projectReport'
import { palette, space } from '../../../theme'
import { formatQty } from '../pipingFormat'
import { ActualPreviewBody } from './ActualPreviewBody'
import { actualPreview, type ActualPreview } from './actualPreview'

/**
 * Import Actual (spec §6.3, §8, R-11), for a foreman of the project and the
 * admin: "Tải file mẫu Actual" downloads the template; "Import Actual" reads
 * the file, checks it (rows, dates, SpoolNo known, order kept, no day after
 * today) and lists any error -- nothing is written then. A clean file is
 * previewed from the database's own dry run: the spools saved, the stored
 * dates it replaces (old -> new, to agree to), a SpoolNo matching several
 * spools applied to all. The import itself is all or nothing and logged.
 */

const NO_DATA_ROWS = 'File không có dòng dữ liệu nào'

type Step =
  | { kind: 'errors'; fileName: string; errors: ImportIssue[] }
  | {
    kind: 'preview'
    fileName: string
    fileRows: number
    changes: ActualChange[]
    preview: ActualPreview
    warnings: ImportIssue[]
  }

export function ActualImportFlow({ projectId, todayKey, onImported }: {
  projectId: string
  todayKey: DayKey
  onImported: () => void
}) {
  const { message } = App.useApp()
  const type = useTypeScale()
  const [reading, setReading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [step, setStep] = useState<Step | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Set synchronously, unlike `saving`: a fast double click must not import twice. */
  const committing = useRef(false)

  const downloadTemplate = async () => {
    setDownloading(true)
    try {
      downloadWorkbook(await buildSpoolActualTemplate(), templateFileName('spool_actual'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDownloading(false)
    }
  }

  const read = async (file: File) => {
    setReading(true)
    setSaveError(null)
    setOverwrite(false)
    const refuse = (errors: ImportIssue[]) => setStep({ kind: 'errors', fileName: file.name, errors })
    try {
      const parsed = parseSpoolActual(await readWorkbookRows(file))
      if (parsed.errors.length > 0) return refuse(parsed.errors)
      if (parsed.rows.length === 0) return refuse([{ row: null, message: NO_DATA_ROWS }])
      // The spools as stored now, not as the page read them: the SpoolNo
      // matches, the old dates shown and the counts come from the same moment
      // as the dry run.
      const fresh = await listSpools(projectId)
      const resolved = resolveSpoolActualImport(parsed.rows, fresh, todayKey)
      if (resolved.errors.length > 0) return refuse(resolved.errors)
      const changes = flattenActualUpdates(resolved.updates)
      // Spools whose every date in the file is already stored: no change is sent for them.
      const asked = new Set(resolved.changes.map((c) => c.spoolId)).size
      const alreadySet = asked - resolved.spoolCount
      let preview: ActualPreview = { save: 0, overwriteSpools: 0, overwrites: [], skipped: [], unchanged: 0 }
      if (changes.length > 0) {
        const results = await setSpoolActuals(projectId, changes, {
          importFile: file.name, dryRun: true, fileRows: parsed.rowCount,
        })
        preview = actualPreview(fresh, changes, results)
        // The database judged otherwise (the spools changed since they were read): refused, nothing written.
        if (preview.skipped.length > 0) {
          return refuse(preview.skipped.map((s) => ({ row: null, message: `SpoolNo "${s.spoolNo}": ${s.reason}` })))
        }
      }
      setStep({
        kind: 'preview',
        fileName: file.name,
        fileRows: parsed.rowCount,
        changes,
        preview: { ...preview, unchanged: preview.unchanged + alreadySet },
        warnings: resolved.warnings,
      })
    } catch (e) {
      refuse([{ row: null, message: (e as Error).message }])
    } finally {
      setReading(false)
    }
  }

  const needsAgreement = step?.kind === 'preview' && step.preview.overwriteSpools > 0
  const canImport = step?.kind === 'preview' && step.changes.length > 0 && (!needsAgreement || overwrite)

  const confirm = async () => {
    if (step?.kind !== 'preview' || !canImport || committing.current) return
    committing.current = true
    setSaving(true)
    setSaveError(null)
    try {
      // One flag for the whole file (the RPC takes no per-spool expectation):
      // a date set on a spool the preview showed blank, between the preview
      // and this call, is replaced too when the overwrite was agreed to. The
      // window is the time the dialog stays open; the manual entry splits its
      // calls instead, which an all-or-nothing import cannot.
      const results = await setSpoolActuals(projectId, step.changes, {
        importFile: step.fileName, fileRows: step.fileRows, overwrite: needsAgreement,
      })
      message.success(`Đã import Insulation Actual cho ${formatQty(results.filter((r) => r.status === 'saved').length)} spool`)
      setStep(null)
      onImported()
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      committing.current = false
      setSaving(false)
    }
  }

  const close = () => {
    if (!saving) setStep(null)
  }

  return (
    <>
      <IconAction verb="template" label="Tải file mẫu Actual" loading={downloading} onClick={() => void downloadTemplate()} />
      <Upload
        accept=".xlsx"
        disabled={reading}
        showUploadList={false}
        maxCount={1}
        beforeUpload={(file) => {
          void read(file)
          // Nothing is uploaded anywhere: the file is read in the browser.
          return false
        }}
      >
        <Button icon={<UploadOutlined aria-hidden />} loading={reading}>Import Actual</Button>
      </Upload>

      <Modal
        open={step?.kind === 'errors'}
        title={step ? `Không import được ${step.fileName}` : ''}
        onCancel={close}
        width={640}
        {...modalProps}
        footer={[<Button key="close" onClick={close}>Đóng</Button>]}
      >
        {step?.kind === 'errors' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
            <Alert type="error" showIcon message={`${formatQty(step.errors.length)} lỗi · chưa có dòng nào được import`} />
            <Table<ImportIssue & { key: number }>
              rowKey="key"
              dataSource={step.errors.map((issue, key) => ({ ...issue, key }))}
              pagination={tablePagination(step.errors.length)}
              columns={[
                {
                  title: 'Dòng',
                  dataIndex: 'row',
                  align: 'center',
                  width: 90,
                  render: (row: number | null) => (row === null ? MISSING : formatQty(row)),
                },
                { title: 'Lỗi', dataIndex: 'message' },
              ]}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={step?.kind === 'preview'}
        title="Xem trước Insulation Actual"
        onCancel={close}
        width={720}
        {...modalProps}
        footer={[
          <Button key="cancel" disabled={saving} onClick={close}>Huỷ</Button>,
          <Button key="ok" type="primary" disabled={!canImport} loading={saving} onClick={() => void confirm()}>
            Import Actual
          </Button>,
        ]}
      >
        {step?.kind === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
            <span style={{ ...type.bodyStrong }}>{step.fileName}</span>
            <ActualPreviewBody
              preview={step.preview}
              overwrite={overwrite}
              onOverwrite={setOverwrite}
              warnings={step.warnings}
              error={saveError}
            />
            <span style={{ ...type.caption, color: palette.textSecondary }}>
              {step.changes.length === 0
                ? 'File không thay đổi ngày Actual nào.'
                : 'Lần import được ghi vào lịch sử import.'}
            </span>
          </div>
        )}
      </Modal>
    </>
  )
}
