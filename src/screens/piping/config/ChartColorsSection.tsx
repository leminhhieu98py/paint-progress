import { Alert, App, Button, ColorPicker, Space } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { chartGroups } from '../../../domain/piping/manpower'
import type { ManpowerGroup, PipingSettings } from '../../../domain/piping/types'
import { listManpowerActual, listManpowerGroups, listManpowerPlan, updatePipingSettings } from '../../../lib/pipingApi'
import { space, type } from '../../../theme'
import { chartColorSections, resolveChartColors } from '../chartColors'

/** The groups as Cấu hình lists them, and in the order whose place picks a group's default hue. */
interface Groups {
  listed: ManpowerGroup[]
  byHue: ManpowerGroup[]
}

/**
 * Màu biểu đồ (RV8-2): one picker per series of the three Piping charts,
 * showing the stored colour or the default. Only what the admin picks is
 * stored; "Khôi phục mặc định" clears the map after a confirm. Saved with the
 * other settings (the stored Thông số go back unchanged), and the page
 * re-reads them so the charts and the report follow.
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

  const save = async (chartColors: Record<string, string>, success: string) => {
    setSaving(true)
    try {
      await updatePipingSettings(projectId, {
        weekStartDate: settings.weekStartDate,
        totalTestPacks: settings.totalTestPacks,
        lateThresholdDays: settings.lateThresholdDays,
        chartColors,
      })
      setPicked(chartColors)
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
            <div
              style={{
                display: 'grid', gridTemplateColumns: 'minmax(160px, max-content) auto', alignItems: 'center',
                gap: `${space.sm}px ${space.lg}px`,
              }}
            >
              {section.rows.map((row) => (
                <ColorRow
                  key={row.key}
                  label={row.label}
                  value={colors[row.key]}
                  onChange={(hex) => setPicked((p) => ({ ...p, [row.key]: hex }))}
                />
              ))}
            </div>
          </section>
        ))}
        <Space>
          <Button type="primary" loading={saving && !resetting} onClick={() => void save(picked, 'Đã lưu màu biểu đồ')}>
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

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <>
      <span>{label}</span>
      <span>
        <ColorPicker
          aria-label={`Màu · ${label}`}
          value={value}
          format="hex"
          disabledAlpha
          showText
          onChange={(color) => onChange(color.toHexString())}
        />
      </span>
    </>
  )
}
