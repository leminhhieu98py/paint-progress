import { UploadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Modal, Segmented, Table, Upload } from 'antd'
import { useRef, useState } from 'react'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { IconAction } from '../../components/IconAction'
import { KeyFacts } from '../../components/KeyFacts'
import { modalProps } from '../../components/modalChrome'
import { StatusPill, type StatusTone } from '../../components/StatusPill'
import { tablePagination } from '../../components/tablePagination'
import { useTypeScale } from '../../components/typeScale'
import type { ImportIssue, ParseResult, PlanImportMode, SheetRows } from '../../domain/piping/imports'
import { downloadWorkbook } from '../../lib/projectReport'
import { readWorkbookRows } from '../../lib/piping/xlsx'
import { MISSING } from '../../lib/format'
import { palette, space } from '../../theme'
import { capList } from './listCap'

/**
 * The admin's Plan import (spec §8), one flow for every hạng mục: "Tải file
 * mẫu" (an icon action, ACT-01) downloads the header-only template; "Nhập Plan" reads the picked
 * workbook, parses it, and then either lists the row errors (nothing written,
 * no half import) or previews what the replace changes -- added, changed,
 * removed, old -> new, with counts -- and replaces the plan only when the
 * admin confirms -- after typing XOÁ when the replace destroys more than the
 * plan (the caller's `dangers`). The caller owns what is specific: the
 * parser, the diff against what is stored, and the write.
 *
 * With `modes` (RV8-5) the preview offers "Plan | Update Plan" (Plan first):
 * switching parses the file again in that mode and recomputes the preview,
 * so the admin sees what each mode does before confirming; the commit and the
 * log summary carry the mode.
 *
 * The same flow imports an Actual file (RV8-6): the props name its template,
 * its button and its confirm, and an overwrite of stored values (the caller's
 * `overwrites`) is confirmed in a second dialog first.
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
  /** A danger badge beside the label, e.g. `có Actual` on a removed spool that carries actual dates. */
  flag?: string
}

/** What a confirmed import would change, as the caller's diff counts it. */
export interface PlanImportPreview {
  added: number
  changed: number
  /** Absent when the import removes nothing by design (Update Plan): the count is not offered then. */
  removed?: number
  unchanged: number
  lines: PlanDiffLine[]
  /**
   * When set, shown in place of the parse's warnings: Update Plan judges
   * duplicates and plan order on the merged result (RV8-5).
   */
  warnings?: ImportIssue[]
  /** Anything else the confirm does that the admin must know, one sentence each. */
  consequences?: string[]
  /**
   * What the confirm destroys beyond the plan itself (spools deleted with
   * their actuals), one sentence each, said in the danger tone; the confirm
   * button turns danger too.
   */
  dangers?: string[]
  /**
   * The stored values the confirm overwrites (an Actual import), one item
   * each, e.g. `Ghi đè 2 ngày đã có số liệu`: asked in a confirmation dialog
   * before anything is written.
   */
  overwrites?: string[]
}

export interface PlanImportFlowProps<R> {
  /** The plan as the file names it (Q27): "Reinstatement Plan"; or the Actual, "Reinstatement Actual". */
  planLabel: string
  /** The template action's name: "Tải file mẫu" by default. */
  templateLabel?: string
  /** The upload button's text: "Nhập Plan" by default. */
  importText?: string
  /** The confirm button's text: "Thay thế Plan" by default ("Update Plan" in that mode). */
  okText?: string
  /** The preview's first consequence, from the file's row count: what a replace or an update does by default. */
  leadLine?: (fileRows: number) => string
  /** The template's file name (`templateFileName`). */
  templateName: string
  buildTemplate: () => Promise<Blob>
  /** The pure parser of `domain/piping/imports.ts`, in the mode picked ('replace' without `modes`). */
  parse: (sheets: SheetRows[], mode: PlanImportMode) => ParseResult<R>
  /**
   * The parsed rows against what is stored now; may be async, so the caller
   * can read what is stored afresh when the file is read (a refusal is shown
   * as a file error and nothing is written).
   */
  preview: (rows: R[], mode: PlanImportMode) => PlanImportPreview | Promise<PlanImportPreview>
  /** Offers "Plan | Update Plan" in the preview (RV8-5). */
  modes?: boolean
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
  /** Writes the plan in `mode`; `summary` is the client's note for the import log. */
  commit: (input: { rows: R[]; fileName: string; summary: Record<string, unknown>; mode: PlanImportMode }) => Promise<unknown>
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

/** The mode switch (RV8-5): the file's own English words, and what each does. */
const MODES: Array<{ value: PlanImportMode; label: string; help: string }> = [
  { value: 'replace', label: 'Plan', help: 'Xoá Plan cũ, thay bằng file (kể cả ô trống)' },
  { value: 'update', label: 'Update Plan', help: 'Chỉ cập nhật ngày/spool có dữ liệu trong file, giữ nguyên phần còn lại' },
]

/** `sheets` is the file as read, kept to parse it again in the other mode; absent when it could not be read. */
type Step<R> =
  | { kind: 'errors'; fileName: string; errors: ImportIssue[]; mode: PlanImportMode; sheets?: SheetRows[] }
  | { kind: 'preview'; fileName: string; parsed: ParseResult<R>; preview: PlanImportPreview; mode: PlanImportMode; sheets: SheetRows[] }

export function PlanImportFlow<R>({
  planLabel, templateLabel = 'Tải file mẫu', importText = 'Nhập Plan', okText: replaceText = 'Thay thế Plan', leadLine,
  templateName, buildTemplate, parse, preview, modes = false, lineHeader, lineAlign = 'center', countFileRows, commit,
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
   * The second confirmation is open: typed when the replace deletes what the
   * `dangers` name, plain when the import overwrites what `overwrites` name.
   */
  const [arming, setArming] = useState(false)
  /**
   * Set synchronously, unlike `saving`: a fast double click on Thay thế Plan
   * must not replace twice (and log a second, empty import).
   */
  const committing = useRef(false)
  /** The mode being switched to while its preview is computed. */
  const [switching, setSwitching] = useState<PlanImportMode | null>(null)
  /** Only the last switch lands: a slow preview of an earlier pick is dropped. */
  const evaluation = useRef(0)

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

  /** The file in one mode: its row errors, or the preview of what it changes. */
  const evaluate = async (fileName: string, sheets: SheetRows[], mode: PlanImportMode): Promise<Step<R>> => {
    try {
      const parsed = parse(sheets, mode)
      // A file with a header and no data (the template sent back untouched)
      // would replace the plan with nothing: refused like any other error.
      const errors = parsed.errors.length > 0 || parsed.rows.length > 0
        ? parsed.errors
        : [{ row: null, message: NO_DATA_ROWS }]
      return errors.length > 0
        ? { kind: 'errors', fileName, errors, mode, sheets }
        : { kind: 'preview', fileName, parsed, preview: await preview(parsed.rows, mode), mode, sheets }
    } catch (e) {
      // The caller's refusal (what is stored could not be read): one file-level error.
      return { kind: 'errors', fileName, errors: [{ row: null, message: (e as Error).message }], mode, sheets }
    }
  }

  const read = async (file: File) => {
    setReading(true)
    evaluation.current += 1
    try {
      const sheets = await readWorkbookRows(file)
      setSaveError(null)
      setStep(await evaluate(file.name, sheets, 'replace'))
    } catch (e) {
      // A file that cannot be opened at all (too big, not .xlsx): one file-level error.
      setStep({ kind: 'errors', fileName: file.name, errors: [{ row: null, message: (e as Error).message }], mode: 'replace' })
    } finally {
      setReading(false)
    }
  }

  const switchMode = async (mode: PlanImportMode) => {
    if (!step?.sheets || saving || mode === step.mode) return
    const token = ++evaluation.current
    setSwitching(mode)
    const next = await evaluate(step.fileName, step.sheets, mode)
    if (token !== evaluation.current) return
    setSaveError(null)
    setStep(next)
    setSwitching(null)
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
        summary: {
          sheet: step.parsed.sheetName,
          warnings: (step.preview.warnings ?? step.parsed.warnings).length,
          ...(modes ? { mode: step.mode } : {}),
        },
        mode: step.mode,
      })
      message.success(`Đã import ${planLabel}`)
      setArming(false)
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
    if (saving) return
    evaluation.current += 1
    setSwitching(null)
    setArming(false)
    setStep(null)
  }

  const dangers = step?.kind === 'preview' ? step.preview.dangers ?? [] : []
  const overwrites = step?.kind === 'preview' ? step.preview.overwrites ?? [] : []
  const allWarnings = step?.kind === 'preview' ? step.preview.warnings ?? step.parsed.warnings : []
  const warnings = capList(allWarnings)
  const okText = step?.mode === 'update' ? 'Update Plan' : replaceText
  const fileRows = step?.kind === 'preview'
    ? (countFileRows ? countFileRows(step.parsed.rows) : step.parsed.rows.length)
    : 0

  /** Plan | Update Plan and what the picked one does, atop either dialog of a file that was read. */
  const modeSwitch = modes && step?.sheets && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
      <Segmented<PlanImportMode>
        aria-label="Chế độ import"
        value={switching ?? step.mode}
        disabled={saving}
        onChange={(mode) => void switchMode(mode)}
        options={MODES.map(({ value, label }) => ({ value, label }))}
        style={{ alignSelf: 'flex-start' }}
      />
      <span style={{ ...type.body, color: palette.textSecondary }}>
        {MODES.find((m) => m.value === (switching ?? step.mode))!.help}
      </span>
    </div>
  )

  return (
    <>
      <IconAction verb="template" label={templateLabel} loading={downloading} onClick={() => void downloadTemplate()} />
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
        <Button type="primary" icon={<UploadOutlined aria-hidden />} loading={reading}>{importText}</Button>
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
            {modeSwitch}
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
            danger={dangers.length > 0}
            loading={saving}
            disabled={switching !== null}
            onClick={() => (dangers.length > 0 || overwrites.length > 0 ? setArming(true) : void confirm())}
          >
            {okText}
          </Button>,
        ]}
      >
        {step?.kind === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
            {modeSwitch}
            {saveError && <Alert type="error" showIcon message={saveError} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <span style={{ ...type.bodyStrong }}>{step.fileName}</span>
              <KeyFacts
                facts={[
                  { value: COUNT.format(step.preview.added), label: 'thêm' },
                  { value: COUNT.format(step.preview.changed), label: 'sửa' },
                  ...(step.preview.removed === undefined ? [] : [{ value: COUNT.format(step.preview.removed), label: 'xoá' }]),
                  { value: COUNT.format(step.preview.unchanged), label: 'giữ nguyên' },
                ]}
              />
            </div>
            {allWarnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${COUNT.format(allWarnings.length)} cảnh báo`}
                description={(
                  <ul style={{ margin: 0, paddingInlineStart: space.lg }}>
                    {warnings.shown.map((w, i) => (
                      <li key={i}>{w.row === null ? w.message : `Dòng ${COUNT.format(w.row)}: ${w.message}`}</li>
                    ))}
                    {warnings.more > 0 && <li>{`và ${COUNT.format(warnings.more)} cảnh báo khác`}</li>}
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
                        <StatusPill tone="danger">{line.flag}</StatusPill>
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
              <li>
                {leadLine ? leadLine(fileRows) : step.mode === 'update'
                  ? `${planLabel} được cập nhật theo ${COUNT.format(fileRows)} dòng của file, phần còn lại giữ nguyên.`
                  : `${planLabel} hiện tại được thay toàn bộ bằng ${COUNT.format(fileRows)} dòng của file.`}
              </li>
              {(step.preview.consequences ?? []).map((c) => <li key={c}>{c}</li>)}
              {(step.preview.dangers ?? []).map((c) => (
                <li key={c} style={{ ...type.bodyStrong, color: palette.error }}>{c}</li>
              ))}
              <li>Lần import được ghi vào lịch sử import.</li>
            </ul>
          </div>
        )}
      </Modal>

      <ConsequenceModal
        open={arming && step?.kind === 'preview'}
        {...(dangers.length > 0
          ? {
            tone: 'danger' as const,
            title: `Thay thế ${planLabel}?`,
            consequences: dangers,
            confirmText: 'XOÁ',
            confirmLabel: 'Gõ XOÁ để xác nhận',
          }
          : { tone: 'warn' as const, title: `Ghi đè ${planLabel}?`, consequences: overwrites })}
        okText={okText}
        confirmLoading={saving}
        error={saveError}
        onOk={() => void confirm()}
        onCancel={() => !saving && setArming(false)}
      />
    </>
  )
}
