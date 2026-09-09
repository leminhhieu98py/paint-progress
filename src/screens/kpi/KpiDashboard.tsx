import { Select } from 'antd'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { SectionCard } from '../../components/SectionCard'
import { kpiSeries, plannedAreaM2, type KpiScopeStage } from '../../domain/kpi'
import { formatAreaM2 } from '../../lib/format'
import { palette } from '../../theme'
import { KpiComboChart } from '../dashboard/charts'

/**
 * KPI Plan vs Actual (Feedback Rv5, item 9, rules RV5-26 and RV5-27).
 *
 * Presentational: the planned coats arrive assembled, the same contract
 * `ProductivityDashboard` has, so this file holds the filters and the empty
 * state and nothing about where a plan or an event comes from. Every figure is
 * `domain/kpi.ts`'s, which is the module asserted against `KPI.xlsx` itself.
 *
 * The same component for the admin, the foreman and the viewer: nothing on it
 * writes, and RV5-28/RV5-29 give all three the read.
 */

/** One planned coat of the project, ready to be filtered and summed. */
export interface KpiEntry extends KpiScopeStage {
  deckId: string
  deckName: string
}

/**
 * Postgres text cannot hold a NUL byte, so it cannot appear in a work or coat
 * name and cannot collide -- the same key `domain/today.ts` builds.
 */
const coatKey = (workName: string, stageName: string) => `${workName}\u0000${stageName}`

const ALL = ''

export function KpiDashboard({
  entries,
  decks,
}: {
  entries: KpiEntry[]
  decks: { id: string; name: string }[]
}) {
  const [deckId, setDeckId] = useState<string>(ALL)
  const [coat, setCoat] = useState<string>(ALL)

  const byDeck = useMemo(
    () => (deckId === ALL ? entries : entries.filter((e) => e.deckId === deckId)),
    [entries, deckId],
  )

  /**
   * The Công đoạn options follow the chosen Sàn (RV5-27's Dự án -> Sàn ->
   * Công đoạn), so picking a deck cannot leave a coat selected that the deck
   * does not have.
   *
   * Keyed on (work, coat) and not on the coat name alone: two works over one
   * deck may carry identically-named coats, and RV5-18 already established
   * that fusing them reads as one coat that does not exist. The label carries
   * the work name only when there is more than one work in view, so the
   * ordinary single-work project reads as a plain list of coats.
   */
  const coats = useMemo(() => {
    const works = new Set(byDeck.map((e) => e.plan.workName))
    const seen = new Map<string, string>()
    for (const e of byDeck) {
      const key = coatKey(e.plan.workName, e.plan.stageName)
      if (!seen.has(key)) {
        seen.set(key, works.size > 1 ? `${e.plan.workName} · ${e.plan.stageName}` : e.plan.stageName)
      }
    }
    return [...seen].map(([value, label]) => ({ value, label }))
  }, [byDeck])

  const scoped = useMemo(
    () => (coat === ALL ? byDeck : byDeck.filter((e) => coatKey(e.plan.workName, e.plan.stageName) === coat)),
    [byDeck, coat],
  )

  const series = useMemo(() => kpiSeries(scoped), [scoped])

  const totalPlanned = scoped.reduce((sum, e) => sum + plannedAreaM2(e.plan, e.computedAreaM2), 0)
  const totalActual = series.reduce((sum, d) => sum + d.actualM2, 0)

  // A coat the chosen deck no longer has must not stay selected: the filter
  // would then be narrowing to nothing and the empty state would look like a
  // deck with no plan.
  const coatValue = coats.some((c) => c.value === coat) ? coat : ALL

  return (
    <SectionCard
      title="KPI kế hoạch so với thực hiện"
      summary={
        scoped.length === 0
          ? undefined
          : `${scoped.length} công đoạn · kế hoạch ${formatAreaM2(totalPlanned)} m² · thực hiện ${formatAreaM2(totalActual)} m²`
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          data-testid="kpi-filters"
          style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <Select
            aria-label="Sàn"
            style={{ width: 220 }}
            value={deckId}
            onChange={(v) => {
              setDeckId(v)
              setCoat(ALL)
            }}
            options={[
              { value: ALL, label: 'Tất cả sàn' },
              ...decks.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
          <Select
            aria-label="Công đoạn"
            style={{ width: 240 }}
            value={coatValue}
            onChange={setCoat}
            options={[{ value: ALL, label: 'Tất cả công đoạn' }, ...coats]}
          />
        </div>

        {series.length === 0 ? (
          <EmptyState
            title="Chưa có kế hoạch KPI nào trong phạm vi này"
            description="Biểu đồ vẽ theo các công đoạn đã được nhập ngày bắt đầu và ngày kết thúc. Admin nhập kế hoạch ở bảng Kế hoạch KPI theo công đoạn."
          />
        ) : (
          <>
            <KpiComboChart data={series} />
            {/*
              RV5-25's consequence, said out loud because it is unlike every
              other m² figure in this app and a reader comparing two
              screenshots taken a day apart would otherwise think the chart is
              broken.
            */}
            <p
              data-testid="kpi-correction-note"
              style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: palette.textTertiary }}
            >
              Diện tích thực hiện được tính theo lần cập nhật SAU CÙNG của mỗi ô ở mỗi công đoạn.
              Nếu giám sát sửa lại một ô, diện tích đó chuyển sang ngày sửa và không còn ở ngày cũ —
              nên số của một ngày đã qua có thể thay đổi. Đây là cách khách hàng yêu cầu, để sửa
              được số nhập sai thay vì cộng dồn hai lần.
            </p>
          </>
        )}
      </div>
    </SectionCard>
  )
}
