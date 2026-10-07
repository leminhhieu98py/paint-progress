import { Alert, App, Button, DatePicker, InputNumber } from 'antd'
import dayjs from 'dayjs'
import { useRef, useState } from 'react'
import { InfoTip } from '../../../components/InfoTip'
import { useTypeScale } from '../../../components/typeScale'
import { viNumberInputProps } from '../../../components/viNumberInput'
import { valuesOnDay } from '../../../domain/piping/manpower'
import type { DayKey, ManpowerGroup, ManpowerValue } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { setManpowerActual, type ManpowerActualInput } from '../../../lib/pipingApi'
import { palette, space } from '../../../theme'

/** Why a foreman's filled cell is read-only (R-7); also the InfoTip's aria-label. */
const LOCKED_INFO = 'Ô đã có giá trị chỉ admin sửa được'

/**
 * Nhập nhân lực (spec §5, R-7, R-8): a day up to today, then one input per
 * visible group showing what that day already has. A foreman fills empty
 * cells only -- a filled one is read-only -- and leaves any group empty; the
 * admin overwrites any cell, and a cell the admin clears is deleted. Only the
 * cells that change are sent. The panel owns the day, so the admin's Sửa in
 * the history opens a day here. The database holds the same rules, and
 * whatever it refuses with is shown as it says it.
 */
export function ManpowerEntryForm({ projectId, groups, actual, admin, todayKey, day, onDayChange, onSaved }: {
  projectId: string
  /** The groups to enter, in order (`entryGroups`: visible only). */
  groups: ManpowerGroup[]
  actual: ManpowerValue[]
  admin: boolean
  todayKey: DayKey
  day: DayKey | null
  onDayChange: (day: DayKey | null) => void
  /** After a save: the panel reads its data again. */
  onSaved: () => void
}) {
  const existing = day === null ? new Map<string, number>() : valuesOnDay(actual, day)
  // A new day, or new stored values after a save, start the inputs over from what is stored.
  const stored = groups.map((g) => `${g.id}=${existing.get(g.id) ?? ''}`).join('|')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <DatePicker
        aria-label="Ngày"
        format="DD/MM/YYYY"
        value={day === null ? null : dayjs(day)}
        // Today is the Vietnam day the page read (`todayKey`), not the browser's clock.
        disabledDate={(d) => d.format('YYYY-MM-DD') > todayKey}
        onChange={(d) => onDayChange(d === null ? null : d.format('YYYY-MM-DD'))}
        style={{ width: 200, maxWidth: '100%' }}
      />
      {day !== null && (
        <DayCells
          key={`${day}|${stored}`}
          projectId={projectId}
          groups={groups}
          existing={existing}
          admin={admin}
          day={day}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

function DayCells({ projectId, groups, existing, admin, day, onSaved }: {
  projectId: string
  groups: ManpowerGroup[]
  existing: Map<string, number>
  admin: boolean
  day: DayKey
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const type = useTypeScale()
  const [draft, setDraft] = useState<Record<string, number | null>>(
    () => Object.fromEntries(groups.map((g) => [g.id, existing.get(g.id) ?? null])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Set synchronously, unlike `saving`: a second Enter or a fast double click
   * during the round trip must not send the day twice.
   */
  const inFlight = useRef(false)

  const locked = (groupId: string) => !admin && existing.has(groupId)
  const changes: ManpowerActualInput[] = groups.flatMap((g) => {
    const before = existing.get(g.id) ?? null
    const after = draft[g.id] ?? null
    if (admin) return after === before ? [] : [{ groupId: g.id, value: after }]
    // A foreman sends a value for an empty cell only; an empty input is skipped.
    return before === null && after !== null ? [{ groupId: g.id, value: after }] : []
  })

  const save = async () => {
    if (inFlight.current || changes.length === 0) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await setManpowerActual(projectId, day, changes)
      message.success(`Đã lưu nhân lực ngày ${formatDayMonthYear(day)}`)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.md }}>
        {groups.map((g) => (
          <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: space.xs, flex: '1 1 140px', maxWidth: 200 }}>
            <span style={{ ...type.label, color: palette.textSecondary }}>{g.name}</span>
            <InputNumber<number>
              aria-label={g.name}
              {...viNumberInputProps}
              min={0}
              value={draft[g.id] ?? null}
              disabled={saving || locked(g.id)}
              onChange={(v) => {
                setDraft((d) => ({ ...d, [g.id]: v }))
                setError(null)
              }}
              onPressEnter={() => void save()}
              style={{ width: '100%' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
          <Button type="primary" disabled={changes.length === 0} loading={saving} onClick={() => void save()}>
            Lưu nhân lực
          </Button>
          {groups.some((g) => locked(g.id)) && <InfoTip text={LOCKED_INFO} />}
        </div>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
    </>
  )
}
