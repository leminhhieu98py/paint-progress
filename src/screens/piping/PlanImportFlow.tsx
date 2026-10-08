import { UploadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Modal, Table, Upload } from 'antd'
import { useRef, useState } from 'react'
import { IconAction } from '../../components/IconAction'
import { KeyFacts } from '../../components/KeyFacts'
import { modalProps } from '../../components/modalChrome'
import { StatusPill, type StatusTone } from '../../components/StatusPill'
import { tablePagination } from '../../components/tablePagination'
import { useTypeScale } from '../../components/typeScale'
import type { ImportIssue, ParseResult, SheetRows } from '../../domain/piping/imports'
import { downloadWorkbook } from '../../lib/projectReport'
import { readWorkbookRows } from '../../lib/piping/xlsx'
import { MISSING } from '../../lib/format'
import { palette, space } from '../../theme'

/**
 * The admin's Plan import (spec §8), one flow for every hạng mục: "Tải file
 * mẫu" (an icon action, ACT-01) downloads the header-only template; "Import Plan" reads the picked
 * workbook, parses it, and then either lists the row errors (nothing written,
 * no half import) or previews what the replace changes -- added, changed,
 * removed, old -> new, with counts -- and replaces the plan only when the
 * admin confirms. The caller owns what is specific: the parser, the diff
 * against what is stored, and the write.
 */

/** One line of the preview: a day (or a day and group, a spool and column) and its old -> new value. */
export interface PlanDiffLine {
  /** Unique within the preview. */
  key: string
  change: 'added' | 'changed' | 'removed'
  /** What changes, e.g. `02/10/2026`. */
  label: string
  /** The stored value; null when added. */
  from: string | null
  /** The file's value; null when removed. */
  to: string | null
  /** A badge beside the label, e.g. `có Actual` on a removed spool that carries actual dates. */
  flag?: string
}

/** What a confirmed import would change, as the caller's diff counts it. */
export interface PlanImportPreview {
  added: number
  changed: number
  removed: number
  unchanged: number
  lines: PlanDiffLine[]
  /** Anything else the confirm does that the admin must know, one sentence each. */
  consequences?: string[]
  /**
   * What the confirm destroys beyond the plan itself (spools deleted with
   * their actuals), one sentence each, said in the danger tone; the confirm
   * button turns danger too.
   */
  dangers?: string[]
}

export interface PlanImportFlowProps<R> {
  /** The plan as the file names it (Q27): "Reinstatement Plan". */
  planLabel: string
  /** The template's file name (`templateFileName`). */
  templateName: string
  buildTemplate: () => Promise<Blob>
  /** The pure parser of `domain/piping/imports.ts`. */
  parse: (sheets: SheetRows[]) => ParseResult<R>
  /** The parsed rows against what is stored now. */
  preview: (rows: R[]) => PlanImportPreview
  /** The preview's first column header: "Ngày". */
  lineHeader: string
  /** How that column aligns: centred for a date (UI-03), left for typed text. */
  lineAlign?: 'left' | 'center'
  /**
   * How many of the file's rows the parsed rows came from, for the preview's
   * "replaced by N rows" line; the row count by default. A file with one value
   * per row and group (Manpower Plan) counts its distinct days.
   */
  countFileRows?: (rows: R[]) => number
  /** Replaces the plan; `summary` is the client's note for the import log. */
  commit: (input: { rows: R[]; fileName: string; summary: Record<string, unknown> }) => Promise<unknown>
  /** After a confirmed import: the caller reads its data again. */
  onImported: () => void
}

const CHANGE: Record<PlanDiffLine['change'], { label: string; tone: StatusTone }> = {
  added: { label: 'Thêm', tone: 'ok' },
  changed: { label: 'Sửa', tone: 'info' },
  removed: { label: 'Xoá', tone: 'warn' },
}

const COUNT = new Intl.NumberFormat('vi-VN')

const NO_DATA_ROWS = 'File không có dòng dữ liệu nào'

type Step<R> =
  | { kind: 'errors'; fileName: string; errors: ImportIssue[] }
  | { kind: 'preview'; fileName: string; parsed: ParseResult<R>; preview: PlanImportPreview }

export function PlanImportFlow<R>({
  planLabel, templateName, buildTemplate, parse, preview, lineHeader, lineAlign = 'center', countFileRows, commit,
  onImported,
}: PlanImportFlowProps<R>) {
  const { message } = App.useApp()
  const type = useTypeScale()
  const [reading, setReading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [step, setStep] = useState<Step<R> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /**
   * Set synchronously, unlike `saving`: a fast double click on Thay thế Plan
   * must not replace twice (and log a second, empty import).
   */
  const committing = useRef(false)

  const downloadTemplate = async () => {
    setDownloading(true)
    try {
      downloadWorkbook(await buildTemplate(), templateName)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDownloading(false)
    }
  }

  const read = async (file: File) => {
    setReading(true)
    try {
      const parsed = parse(await readWorkbookRows(file))
      setSaveError(null)
      // A file with a header and no data (the template sent back untouched)
      // would replace the plan with nothing: refused like any other error.
      const errors = parsed.errors.length > 0 || parsed.rows.length > 0
        ? parsed.errors
        : [{ row: null, message: NO_DATA_ROWS }]
      setStep(errors.length > 0
        ? { kind: 'errors', fileName: file.name, errors }
        : { kind: 'preview', fileName: file.name, parsed, preview: preview(parsed.rows) })
    } catch (e) {
      // A file that cannot be opened at all (too big, not .xlsx): one file-level error.
      setStep({ kind: 'errors', fileName: file.name, errors: [{ row: null, message: (e as Error).message }] })
    } finally {
      setReading(false)
    }
  }

  const confirm = async () => {
    if (step?.kind !== 'preview' || committing.current) return
    committing.current = true
    setSaving(true)
    setSaveError(null)
    try {
      await commit({
        rows: step.parsed.rows,
        fileName: step.fileName,
        summary: { sheet: step.parsed.sheetName, warnings: step.parsed.warnings.length },
      })
      message.success(`Đã import ${planLabel}`)
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
      <IconAction verb="template" label="Tải file mẫu" loading={downloading} onClick={() => void downloadTemplate()} />
      <Upload
        accept=".xlsx"
        // While a file is read, no second pick can race it.
        disabled={reading}
        showUploadList={false}
        maxCount={1}
        beforeUpload={(file) => {
          void read(file)
          // Nothing is uploaded anywhere: the file is read in the browser.
          return false
        }}
      >
        <Button type="primary" icon={<UploadOutlined aria-hidden />} loading={reading}>Import Plan</Button>
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
            <Alert
              type="error"
              showIcon
              message={`${COUNT.format(step.errors.length)} lỗi · chưa có dòng nào được import`}
            />
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
                  render: (row: number | null) => (row === null ? MISSING : COUNT.format(row)),
                },
                { title: 'Lỗi', dataIndex: 'message' },
              ]}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={step?.kind === 'preview'}
        title={`Xem trước ${planLabel}`}
        onCancel={close}
        width={720}
        {...modalProps}
        footer={[
          <Button key="cancel" disabled={saving} onClick={close}>Huỷ</Button>,
          <Button
            key="ok"
            type="primary"
            danger={step?.kind === 'preview' && (step.preview.dangers?.length ?? 0) > 0}
            loading={saving}
            onClick={() => void confirm()}
          >
            Thay thế Plan
          </Button>,
        ]}
      >
        {step?.kind === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
            {saveError && <Alert type="error" showIcon message={saveError} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <span style={{ ...type.bodyStrong }}>{step.fileName}</span>
              <KeyFacts
                facts={[
                  { value: COUNT.format(step.preview.added), label: 'thêm' },
                  { value: COUNT.format(step.preview.changed), label: 'sửa' },
                  { value: COUNT.format(step.preview.removed), label: 'xoá' },
                  { value: COUNT.format(step.preview.unchanged), label: 'giữ nguyên' },
                ]}
              />
            </div>
            {step.parsed.warnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${COUNT.format(step.parsed.warnings.length)} cảnh báo`}
                description={(
                  <ul style={{ margin: 0, paddingInlineStart: space.lg }}>
                    {step.parsed.warnings.map((w, i) => (
                      <li key={i}>{w.row === null ? w.message : `Dòng ${COUNT.format(w.row)}: ${w.message}`}</li>
                    ))}
                  </ul>
                )}
              />
            )}
            {step.preview.lines.length > 0 && (
              <Table<PlanDiffLine>
                rowKey="key"
                dataSource={step.preview.lines}
                pagination={tablePagination(step.preview.lines.length)}
                columns={[
                  {
                    title: 'Thay đổi',
                    dataIndex: 'change',
                    align: 'center',
                    width: 110,
                    render: (change: PlanDiffLine['change']) => (
                      <StatusPill tone={CHANGE[change].tone}>{CHANGE[change].label}</StatusPill>
                    ),
                  },
                  {
                    title: lineHeader,
                    dataIndex: 'label',
                    align: lineAlign,
                    render: (label: string, line: PlanDiffLine) => (line.flag === undefined ? label : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                        {label}
                        <StatusPill tone="warn">{line.flag}</StatusPill>
                      </span>
                    )),
                  },
                  { title: 'Cũ', dataIndex: 'from', align: 'center', render: (v: string | null) => v ?? MISSING },
                  { title: 'Mới', dataIndex: 'to', align: 'center', render: (v: string | null) => v ?? MISSING },
                ]}
              />
            )}
            <ul
              aria-label="Hệ quả"
              style={{
                margin: 0,
                padding: `${space.md}px ${space.lg}px ${space.md}px ${space.xxl}px`,
                display: 'flex',
                flexDirection: 'column',
                gap: space.xs,
                ...type.body,
                color: palette.textSecondary,
                background: palette.bgSubtle,
                border: `1px solid ${palette.borderSplit}`,
                borderRadius: 11,
              }}
            >
              <li>{`${planLabel} hiện tại được thay toàn bộ bằng ${COUNT.format(countFileRows ? countFileRows(step.parsed.rows) : step.parsed.rows.length)} dòng của file.`}</li>
              {(step.preview.consequences ?? []).map((c) => <li key={c}>{c}</li>)}
              {(step.preview.dangers ?? []).map((c) => (
                <li key={c} style={{ ...type.bodyStrong, color: palette.error }}>{c}</li>
              ))}
              <li>Lần import được ghi vào lịch sử import.</li>
            </ul>
          </div>
        )}
      </Modal>
    </>
  )
}
