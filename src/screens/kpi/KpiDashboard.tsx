import { Select, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { SectionCard } from '../../components/SectionCard'
import { searchSelectProps } from '../../components/searchSelect'
import { kpiSeries, plannedAreaM2, type KpiScopeStage } from '../../domain/kpi'
import { DEFAULT_UNIT, MIXED_QUANTITY_LABEL, MIXED_UNIT_SUM_TOOLTIP, unitOfWorks } from '../../domain/unit'
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
  /** The coat's work's unit (RV6-35). Absent reads as m², as every work did before 0036. */
  unit?: string
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
  todayKey,
}: {
  entries: KpiEntry[]
  /** Every deck of the project with its KPI colours (RV6-29); null is the chart's default. */
  decks: { id: string; name: string; kpiPlanColor: string | null; kpiActualColor: string | null }[]
  /** `effortDayKey(new Date())`, read once at the UI boundary (RV6-09). */
  todayKey: string
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

  const series = useMemo(() => kpiSeries(scoped, todayKey), [scoped, todayKey])

  const totalPlanned = scoped.reduce((sum, e) => sum + plannedAreaM2(e.plan, e.computedAreaM2), 0)
  // `?? 0`: a day after todayKey has no actual to report yet (RV6-09), and it
  // must not count as a zero against the total either.
  const totalActual = series.reduce((sum, d) => sum + (d.actualM2 ?? 0), 0)
  /**
   * The unit the scoped coats share (RV6-35): one coat, or every coat in view
   * from works of one unit. Null when the scope mixes units (RV6-36).
   */
  const unit = unitOfWorks(scoped.map((e) => ({ unit: e.unit ?? DEFAULT_UNIT })))

  // A coat the chosen deck no longer has must not stay selected: the filter
  // would then be narrowing to nothing and the empty state would look like a
  // deck with no plan.
  const coatValue = coats.some((c) => c.value === coat) ? coat : ALL

  /**
   * RV6-08's caption under the chart: the selected deck's name (or "Tất cả
   * sàn"), then the chosen coat's label when one is chosen. The coat label is
   * `coats`' own -- it already carries the work name when more than one work
   * is in view, so this reuses it rather than re-deriving it.
   */
  const deck = deckId === ALL ? undefined : decks.find((d) => d.id === deckId)
  const deckLabel = deck?.name ?? 'Tất cả sàn'
  /**
   * RV6-29: the chart takes the selected deck's colours, and only then. Under
   * "Tất cả sàn" the series sum several decks and no one deck's colour is
   * true of them, so the prop is left off and the chart paints its defaults.
   */
  const colors = deck === undefined ? undefined : { plan: deck.kpiPlanColor, actual: deck.kpiActualColor }
  const coatLabel = coats.find((c) => c.value === coatValue)?.label
  const chartTitle = coatValue === ALL || coatLabel === undefined ? deckLabel : `${deckLabel} — ${coatLabel}`

  return (
    <SectionCard
      title="KPI kế hoạch so với thực hiện"
      summary={
        scoped.length === 0
          ? undefined
          : unit === null
            // RV6-36: `Tất cả công đoạn` over works of different units has no
            // sum to print; the figures per coat are one filter away.
            ? (
              <Tooltip title={MIXED_UNIT_SUM_TOOLTIP}>
                <span>{`${scoped.length} công đoạn · kế hoạch — · thực hiện —`}</span>
              </Tooltip>
            )
            : `${scoped.length} công đoạn · kế hoạch ${formatAreaM2(totalPlanned)} ${unit} · thực hiện ${formatAreaM2(totalActual)} ${unit}`
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          data-testid="kpi-filters"
          style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <Select
            aria-label="Sàn"
            {...searchSelectProps}
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
            {...searchSelectProps}
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
            {/*
              Keyed on the filter scope (RV6-10): a deck or coat change is a
              different chart, and the Brush's own zoom/pan state must not
              survive onto it.
            */}
            <KpiComboChart key={`${deckId}|${coatValue}`} data={series} colors={colors} unit={unit ?? MIXED_QUANTITY_LABEL} />
            {/* RV6-08: what the chart above is scoped to. */}
            <p
              data-testid="kpi-chart-title"
              style={{ margin: 0, fontSize: 13, fontWeight: 600, color: palette.textSecondary, textAlign: 'center' }}
            >
              {chartTitle}
            </p>
          </>
        )}
      </div>
    </SectionCard>
  )
}
