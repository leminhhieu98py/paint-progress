import { Alert, App, Button, DatePicker, InputNumber } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useRef, useState } from 'react'
import { viNumberInputProps } from '../../../components/viNumberInput'
import { checkReinstatementEntry } from '../../../domain/piping/reinstatement'
import type { DayKey, ReinstatementActualEntry } from '../../../domain/piping/types'
import { addReinstatementEntry } from '../../../lib/pipingApi'
import { space } from '../../../theme'

/**
 * Thêm số lượng (spec §4, Q9A, Q10A): a foreman of the project, or the admin,
 * adds an entry -- a day up to today and a quantity above 0. The cap and the
 * missing total are checked on screen first (`checkReinstatementEntry`) to
 * spare a failed round trip; the database holds the same rules, and whatever
 * it refuses with is shown as it says it.
 */
export function EntryForm({ projectId, entries, totalTestPacks, todayKey, onAdded }: {
  projectId: string
  entries: ReinstatementActualEntry[]
  totalTestPacks: number | null
  todayKey: DayKey
  onAdded: () => void
}) {
  const { message } = App.useApp()
  const [day, setDay] = useState<Dayjs | null>(() => dayjs(todayKey))
  const [qty, setQty] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Set synchronously, unlike `saving`: a second Enter, a held key or a fast
   * double click during the round trip must not append a second entry.
   */
  const inFlight = useRef(false)

  const add = async () => {
    if (inFlight.current || day === null || qty === null) return
    const dayKey = day.format('YYYY-MM-DD')
    const refused = checkReinstatementEntry({ entries, totalTestPacks, day: dayKey, qty, todayKey })
    if (refused !== null) {
      setError(refused)
      return
    }
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await addReinstatementEntry(projectId, dayKey, qty)
      message.success('Đã thêm số lượng')
      setQty(null)
      onAdded()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm }}>
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
          style={{ flex: '1 1 150px', maxWidth: 200 }}
        />
        <InputNumber<number>
          aria-label="Số lượng"
          placeholder="Số lượng"
          {...viNumberInputProps}
          value={qty}
          onChange={(v) => {
            setQty(v)
            setError(null)
          }}
          onPressEnter={() => void add()}
          style={{ flex: '1 1 120px', maxWidth: 200 }}
        />
        <Button type="primary" disabled={day === null || qty === null} loading={saving} onClick={() => void add()}>
          Thêm số lượng
        </Button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
    </div>
  )
}
