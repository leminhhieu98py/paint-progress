import { Alert, App, Button, DatePicker, Form, Modal, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo, useRef, useState } from 'react'
import { modalProps } from '../../../components/modalChrome'
import { searchSelectProps } from '../../../components/searchSelect'
import { useTypeScale } from '../../../components/typeScale'
import { MILESTONE_LABEL, MILESTONES, type ActualChange } from '../../../domain/piping/cam'
import type { DayKey, Milestone, Spool } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { setSpoolActuals, type SpoolActualResult } from '../../../lib/pipingApi'
import { matchesSearch } from '../../../lib/search'
import { space } from '../../../theme'
import { formatQty } from '../pipingFormat'
import { ActualPreviewBody } from './ActualPreviewBody'
import {
  actualPreview, changesToWrite, TARGET_LABEL, targetSpools, targetValues, type ActualPreview, type TargetKind,
} from './actualPreview'

/**
 * Cập nhật Actual (spec §6.3, Q18A, R-11): a foreman of the project or the
 * admin picks a SpoolNo (every spool carrying it), a LineNo or a Test Package
 * No, a milestone and a day up to today. "Xem trước" asks the database what
 * it would do (a dry run): how many spools it saves, which stored dates it
 * would replace -- saved only once the box is ticked --, which spools break
 * PH <= IH <= IW and are skipped, which hold the date already. "Lưu" then
 * writes the saved ones, and the replaced ones when agreed to.
 */

const KINDS = (Object.keys(TARGET_LABEL) as TargetKind[]).map((k) => ({ value: k, label: TARGET_LABEL[k] }))
const MILESTONE_OPTIONS = MILESTONES.map((m) => ({ value: m, label: MILESTONE_LABEL[m] }))

/** A project holds up to 20 000 spools: the value select lists this many matches at most. */
const MAX_OPTIONS = 100

interface Previewed {
  title: string
  changes: ActualChange[]
  results: SpoolActualResult[]
  preview: ActualPreview
}

export function ActualEntry({ projectId, spools, todayKey, onSaved }: {
  projectId: string
  spools: Spool[]
  todayKey: DayKey
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const type = useTypeScale()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<TargetKind>('spool')
  const [target, setTarget] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [milestone, setMilestone] = useState<Milestone>('ph')
  const [day, setDay] = useState<Dayjs | null>(() => dayjs(todayKey))
  const [step, setStep] = useState<Previewed | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Set synchronously, unlike `busy`: a fast double click must not run the dry run or the write twice. */
  const inFlight = useRef(false)

  const values = useMemo(() => targetValues(spools, kind), [spools, kind])
  const options = useMemo(() => {
    const q = query.trim()
    const matched = q === '' ? values : values.filter((v) => matchesSearch(v, q))
    return matched.slice(0, MAX_OPTIONS).map((v) => ({ value: v, label: v }))
  }, [values, query])

  const start = () => {
    setStep(null)
    setTarget(null)
    setQuery('')
    setDay(dayjs(todayKey))
    setOverwrite(false)
    setError(null)
    setOpen(true)
  }

  const close = () => {
    if (busy !== null) return
    setOpen(false)
    setStep(null)
  }

  const runPreview = async () => {
    if (inFlight.current || target === null || day === null) return
    const date = day.format('YYYY-MM-DD')
    if (date > todayKey) {
      setError(`Ngày ${formatDayMonthYear(date)} sau hôm nay`)
      return
    }
    const changes = targetSpools(spools, kind, target).map((s) => ({ spoolId: s.id, milestone, date }))
    if (changes.length === 0) {
      setError(`Không có spool nào có ${TARGET_LABEL[kind]} ${target}`)
      return
    }
    inFlight.current = true
    setBusy('preview')
    setError(null)
    try {
      const results = await setSpoolActuals(projectId, changes, { dryRun: true })
      setOverwrite(false)
      setStep({
        title: `${TARGET_LABEL[kind]} ${target} · ${MILESTONE_LABEL[milestone]} · ${formatDayMonthYear(date)} · ${formatQty(changes.length)} spool`,
        changes,
        results,
        preview: actualPreview(spools, changes, results),
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const toWrite = step === null ? [] : changesToWrite(step.changes, step.results, overwrite)

  const save = async () => {
    if (inFlight.current || step === null || toWrite.length === 0) return
    inFlight.current = true
    setBusy('save')
    setError(null)
    try {
      const results = await setSpoolActuals(projectId, toWrite, { overwrite })
      const saved = results.filter((r) => r.status === 'saved').length
      const missed = results.length - saved
      if (saved > 0) message.success(`Đã lưu Actual cho ${formatQty(saved)} spool`)
      // Another write landed between the preview and this one: the database judged again.
      if (missed > 0) message.warning(`${formatQty(missed)} spool không được lưu vì dữ liệu vừa thay đổi`)
      setOpen(false)
      setStep(null)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const footer = step === null
    ? [
      <Button key="cancel" disabled={busy !== null} onClick={close}>Huỷ</Button>,
      <Button
        key="preview"
        type="primary"
        disabled={target === null || day === null}
        loading={busy === 'preview'}
        onClick={() => void runPreview()}
      >
        Xem trước
      </Button>,
    ]
    : [
      <Button
        key="back"
        disabled={busy !== null}
        onClick={() => {
          setStep(null)
          setError(null)
        }}
      >
        Quay lại
      </Button>,
      <Button key="save" type="primary" disabled={toWrite.length === 0} loading={busy === 'save'} onClick={() => void save()}>
        Lưu
      </Button>,
    ]

  return (
    <>
      <Button type="primary" onClick={start}>Cập nhật Actual</Button>
      <Modal open={open} title="Cập nhật Actual" onCancel={close} width={step === null ? 520 : 720} {...modalProps} footer={footer}>
        {step === null
          ? (
            <Form layout="vertical" component="div">
              {error && <Alert type="error" showIcon message={error} style={{ marginBottom: space.lg }} />}
              <Form.Item label="Áp dụng cho">
                <Select<TargetKind>
                  aria-label="Áp dụng cho"
                  {...searchSelectProps}
                  value={kind}
                  options={KINDS}
                  onChange={(k) => {
                    setKind(k)
                    setTarget(null)
                    setQuery('')
                    setError(null)
                  }}
                />
              </Form.Item>
              <Form.Item label={TARGET_LABEL[kind]}>
                <Select<string>
                  aria-label={TARGET_LABEL[kind]}
                  {...searchSelectProps}
                  // The options are matched here, so a 20 000-spool list never renders whole.
                  filterOption={false}
                  searchValue={query}
                  onSearch={setQuery}
                  placeholder={`Chọn ${TARGET_LABEL[kind]}`}
                  value={target ?? undefined}
                  options={options}
                  onChange={(v) => {
                    setTarget(v)
                    setQuery('')
                    setError(null)
                  }}
                />
              </Form.Item>
              <Form.Item label="Mốc">
                <Select<Milestone>
                  aria-label="Mốc"
                  {...searchSelectProps}
                  value={milestone}
                  options={MILESTONE_OPTIONS}
                  onChange={(m) => {
                    setMilestone(m)
                    setError(null)
                  }}
                />
              </Form.Item>
              <Form.Item label="Ngày" style={{ marginBottom: 0 }}>
                <DatePicker
                  aria-label="Ngày"
                  format="DD/MM/YYYY"
                  value={day}
                  // Today is the Vietnam day the page read (`todayKey`), not the browser's clock.
                  disabledDate={(d) => d.format('YYYY-MM-DD') > todayKey}
                  onChange={(d) => {
                    setDay(d)
                    setError(null)
                  }}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Form>
          )
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
              <span style={{ ...type.bodyStrong }}>{step.title}</span>
              <ActualPreviewBody preview={step.preview} overwrite={overwrite} onOverwrite={setOverwrite} error={error} />
            </div>
          )}
      </Modal>
    </>
  )
}
