import { App, Select } from 'antd'
import { useRef, useState } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { searchSelectProps } from '../../../components/searchSelect'
import { ACTUAL_FIELD, MILESTONE_LABEL } from '../../../domain/piping/cam'
import type { Milestone, Spool } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { setSpoolActuals } from '../../../lib/pipingApi'
import { setMilestones } from './actualPreview'

/**
 * Xoá Actual (spec §6.3, R-12): the admin clears one milestone's actual date
 * of one spool, after a confirmation naming the spool, the milestone and the
 * date. Mounted with the spool; the caller unmounts it on close.
 */
export function ClearActualModal({ projectId, spool, onClose, onCleared }: {
  projectId: string
  spool: Spool
  onClose: () => void
  onCleared: () => void
}) {
  const { message } = App.useApp()
  const choices = setMilestones(spool)
  const [milestone, setMilestone] = useState<Milestone | undefined>(choices[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set synchronously, unlike `busy`: a double click clears once. */
  const inFlight = useRef(false)
  const date = milestone === undefined ? null : spool[ACTUAL_FIELD[milestone]]

  const clear = async () => {
    if (inFlight.current || milestone === undefined) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const [result] = await setSpoolActuals(projectId, [{ spoolId: spool.id, milestone, date: null }])
      // Gone since the list was read (a Plan import replaced it): nothing was cleared.
      if (result?.status === 'not_found') {
        setError('Không tìm thấy spool. Hãy tải lại trang.')
        return
      }
      message.success(`Đã xoá ${MILESTONE_LABEL[milestone]} – Actual của ${spool.spoolNo}`)
      onCleared()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <ConsequenceModal
      open
      tone="danger"
      title={`Xoá ngày Actual của ${spool.spoolNo}?`}
      description={choices.length > 1 ? (
        <Select<Milestone>
          aria-label="Mốc"
          {...searchSelectProps}
          value={milestone}
          options={choices.map((m) => ({ value: m, label: MILESTONE_LABEL[m] }))}
          onChange={setMilestone}
          style={{ width: '100%' }}
        />
      ) : undefined}
      items={milestone === undefined || date === null ? undefined : [{
        label: `${MILESTONE_LABEL[milestone]} – Actual`,
        meta: formatDayMonthYear(date),
      }]}
      consequences={['Spool trở lại chưa có ngày Actual ở mốc này.']}
      okText="Xoá"
      confirmLoading={busy}
      error={error}
      onOk={() => void clear()}
      onCancel={() => !busy && onClose()}
    />
  )
}
