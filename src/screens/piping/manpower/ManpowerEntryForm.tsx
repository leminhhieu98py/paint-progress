import { Alert, App, Button, DatePicker, InputNumber } from 'antd'
import dayjs from 'dayjs'
import { useRef, useState } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { InfoTip } from '../../../components/InfoTip'
import { useTypeScale } from '../../../components/typeScale'
import { viNumberInputProps } from '../../../components/viNumberInput'
import { valuesOnDay } from '../../../domain/piping/manpower'
import type { DayKey, ManpowerGroup, ManpowerValue } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { setManpowerActual, type ManpowerActualInput } from '../../../lib/pipingApi'
import { palette, space } from '../../../theme'
import { formatQty } from '../pipingFormat'

/** Why a foreman's filled cell is read-only (R-7); also the InfoTip's aria-label. */
const LOCKED_INFO = 'Ô đã có giá trị chỉ admin sửa được'

/** A group's name as the form shows it: a hidden one (admin only) says so. */
const groupLabel = (g: ManpowerGroup) => (g.hidden ? `${g.name} (ẩn)` : g.name)

/**
 * Nhập nhân lực (spec §5, R-7, R-8): a day up to today, then one input per
 * group showing what that day already has. A foreman gets the visible groups
 * and fills empty cells only -- a filled one is read-only -- and leaves any
 * group empty. The admin gets every group, hidden ones marked "(ẩn)" so a
 * wrong hidden value can be corrected, overwrites any cell, and a cell the
 * admin clears is deleted after a confirmation listing the cleared cells.
 * Only the cells that change are sent. The panel owns the day, so the
 * admin's Sửa in the history opens a day here.
 *
 * The database holds the same rules; whatever it refuses with is shown as it
 * says it, and the day is read again -- a foreman refused because another one
 * filled the cell meanwhile then sees that cell locked with its value.
 */
export function ManpowerEntryForm({ projectId, groups, actual, admin, todayKey, day, onDayChange, onChanged }: {
  projectId: string
  /** The groups to enter, in order: visible ones for a foreman (`entryGroups`), all for the admin. */
  groups: ManpowerGroup[]
  actual: ManpowerValue[]
  admin: boolean
  todayKey: DayKey
  day: DayKey | null
  onDayChange: (day: DayKey | null) => void
  /** After a save or a refusal: the panel reads its data again. */
  onChanged: () => void
}) {
  // Held here, not in the cells: a refusal's message outlives the re-read that remounts them.
  const [error, setError] = useState<string | null>(null)
  const existing = day === null ? new Map<string, number>() : valuesOnDay(actual, day)
  // A new day, or new stored values after a write, start the inputs over from what is stored.
  const stored = groups.map((g) => `${g.id}=${existing.get(g.id) ?? ''}`).join('|')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <DatePicker
        aria-label="Ngày"
        format="DD/MM/YYYY"
        value={day === null ? null : dayjs(day)}
        // Today is the Vietnam day the page read (`todayKey`), not the browser's clock.
        disabledDate={(d) => d.format('YYYY-MM-DD') > todayKey}
        onChange={(d) => {
          setError(null)
          onDayChange(d === null ? null : d.format('YYYY-MM-DD'))
        }}
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
          setError={setError}
          onChanged={onChanged}
        />
      )}
      {error && <Alert type="error" showIcon message={error} />}
    </div>
  )
}

function DayCells({ projectId, groups, existing, admin, day, setError, onChanged }: {
  projectId: string
  groups: ManpowerGroup[]
  existing: Map<string, number>
  admin: boolean
  day: DayKey
  setError: (error: string | null) => void
  onChanged: () => void
}) {
  const { message } = App.useApp()
  const type = useTypeScale()
  const [draft, setDraft] = useState<Record<string, number | null>>(
    () => Object.fromEntries(groups.map((g) => [g.id, existing.get(g.id) ?? null])),
  )
  const [saving, setSaving] = useState(false)
  /** The admin's save that clears cells, waiting for the confirmation. */
  const [confirming, setConfirming] = useState(false)
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
  const cleared = groups.filter((g) => changes.some((c) => c.groupId === g.id && c.value === null))

  const send = async () => {
    if (inFlight.current || changes.length === 0) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await setManpowerActual(projectId, day, changes)
      message.success(`Đã lưu nhân lực ngày ${formatDayMonthYear(day)}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setSaving(false)
      setConfirming(false)
    }
    onChanged()
  }

  const save = () => {
    if (inFlight.current || changes.length === 0) return
    // Clearing a stored cell deletes it: the admin confirms first, as for Xoá nhân lực.
    if (cleared.length > 0) setConfirming(true)
    else void send()
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.md }}>
        {groups.map((g) => (
          <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: space.xs, flex: '1 1 140px', maxWidth: 200 }}>
            <span style={{ ...type.label, color: palette.textSecondary }}>{groupLabel(g)}</span>
            <InputNumber<number>
              aria-label={groupLabel(g)}
              {...viNumberInputProps}
              min={0}
              value={draft[g.id] ?? null}
              disabled={saving || locked(g.id)}
              onChange={(v) => {
                setDraft((d) => ({ ...d, [g.id]: v }))
                setError(null)
              }}
              onPressEnter={save}
              style={{ width: '100%' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
          <Button type="primary" disabled={changes.length === 0} loading={saving} onClick={save}>
            Lưu nhân lực
          </Button>
          {groups.some((g) => locked(g.id)) && <InfoTip text={LOCKED_INFO} />}
        </div>
      </div>

      <ConsequenceModal
        open={confirming}
        tone="danger"
        title={`Xoá ${cleared.length} ô nhân lực ngày ${formatDayMonthYear(day)}?`}
        items={cleared.map((g) => ({ label: groupLabel(g), meta: formatQty(existing.get(g.id) ?? 0) }))}
        consequences={['Không khôi phục được']}
        okText="Lưu"
        confirmLoading={saving}
        onOk={() => void send()}
        onCancel={() => !saving && setConfirming(false)}
      />
    </>
  )
}
