import { Alert, App, Button, Space, Spin } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ColorField, HEX_COLOR } from '../../../components/ColorField'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { chartGroups } from '../../../domain/piping/manpower'
import type { ManpowerGroup, PipingSettings } from '../../../domain/piping/types'
import { listManpowerActual, listManpowerGroups, listManpowerPlan, updatePipingChartColors } from '../../../lib/pipingApi'
import { space, type } from '../../../theme'
import { chartColorSections, resolveChartColors } from '../chartColors'

/** A section's rows: the series' name, then its colour, lined up down the section. */
const ROWS = {
  display: 'grid', gridTemplateColumns: 'minmax(160px, max-content) auto', alignItems: 'center',
  gap: `${space.sm}px ${space.lg}px`,
} as const

/** The groups as Cấu hình lists them, and in the order whose place picks a group's default hue. */
interface Groups {
  listed: ManpowerGroup[]
  byHue: ManpowerGroup[]
}

/**
 * Màu biểu đồ (RV8-2): one `ColorField` per series of the three Piping
 * charts, showing the stored colour or the default. Only what the admin picks
 * is stored; "Khôi phục mặc định" clears the map after a confirm. The map is
 * saved alone (never Thông số), and the page re-reads the settings so the
 * charts and the report follow. A hex field mid-keystroke holds Lưu màu shut,
 * as on the stage panel: a colour typed, saved and silently dropped would
 * read as saved.
 *
 * A group's default is its hue on the chart, which colours the groups it draws
 * (`chartGroups`) by place -- so the plan and actual are read too. `refreshKey`
 * re-reads them after a change in Nhóm nhân lực.
 */
export function ChartColorsSection({ projectId, settings, refreshKey, onSaved }: {
  projectId: string
  settings: PipingSettings
  refreshKey: number
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const [picked, setPicked] = useState<Record<string, string>>(settings.chartColors)
  /** What the admin has typed into a hex field, by series key, for as long as it is not yet a colour. */
  const [hexDraft, setHexDraft] = useState<Record<string, string>>({})
  const [groups, setGroups] = useState<Groups | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([listManpowerGroups(projectId), listManpowerPlan(projectId), listManpowerActual(projectId)])
      .then(([listed, plan, actual]) => {
        if (cancelled) return
        const drawn = chartGroups(listed, plan, actual)
        const drawnIds = new Set(drawn.map((g) => g.id))
        setGroups({ listed, byHue: [...drawn, ...listed.filter((g) => !drawnIds.has(g.id))] })
        setLoadError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  const colors = useMemo(() => resolveChartColors(picked, groups?.byHue ?? []), [picked, groups])
  const sections = useMemo(() => chartColorSections(groups?.listed ?? []), [groups])
  const groupsLoading = groups === null && loadError === null
  // Read off the rows on screen, so a draft left by a group no longer listed cannot lock the save.
  const hexPending = sections.some((section) => section.rows.some((row) => {
    const typed = hexDraft[row.key]
    return typed !== undefined && !HEX_COLOR.test(typed)
  }))

  const save = async (chartColors: Record<string, string>, success: string) => {
    setSaving(true)
    try {
      await updatePipingChartColors(projectId, chartColors)
      setPicked(chartColors)
      setHexDraft({})
      setResetting(false)
      message.success(success)
      onSaved()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {loadError && <Alert type="error" showIcon message="Không tải được nhóm nhân lực" description={loadError} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg, marginTop: loadError ? space.md : 0 }}>
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h3 style={{ ...type.label, margin: `0 0 ${space.sm}px` }}>{section.title}</h3>
            {section.title === 'Manpower' && groupsLoading
              ? <Spin style={{ display: 'block', margin: `${space.xxl}px auto` }} />
              : (
                <div style={ROWS}>
                  {section.rows.map((row) => (
                    <ColorRow
                      key={row.key}
                      label={row.label}
                      value={colors[row.key]}
                      hex={hexDraft[row.key]}
                      disabled={saving}
                      onColor={(color) => setPicked((p) => ({ ...p, [row.key]: color }))}
                      onHex={(typed) => setHexDraft((d) => ({ ...d, [row.key]: typed }))}
                    />
                  ))}
                </div>
              )}
          </section>
        ))}
        <Space>
          <Button
            type="primary"
            loading={saving && !resetting}
            disabled={hexPending}
            onClick={() => void save(picked, 'Đã lưu màu biểu đồ')}
          >
            Lưu màu
          </Button>
          <Button disabled={saving} onClick={() => setResetting(true)}>Khôi phục mặc định</Button>
        </Space>
      </div>
      <ConsequenceModal
        open={resetting}
        tone="warn"
        title="Khôi phục màu mặc định?"
        consequences={['Ba biểu đồ Piping và ảnh biểu đồ trong báo cáo dùng lại màu mặc định']}
        okText="Khôi phục"
        confirmLoading={saving}
        onCancel={() => setResetting(false)}
        onOk={() => void save({}, 'Đã khôi phục màu mặc định')}
      />
    </>
  )
}

function ColorRow({ label, value, hex, disabled, onColor, onHex }: {
  label: string
  value: string
  hex: string | undefined
  disabled: boolean
  onColor: (color: string) => void
  onHex: (typed: string) => void
}) {
  return (
    <>
      <span>{label}</span>
      <span>
        <ColorField label={label} value={value} hex={hex} disabled={disabled} onColor={onColor} onHex={onHex} />
      </span>
    </>
  )
}
