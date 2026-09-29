import { SearchOutlined } from '@ant-design/icons'
import { Input, Table, Typography } from 'antd'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { InfoTip } from '../../components/InfoTip'
import { SectionCard } from '../../components/SectionCard'
import { StatCard } from '../../components/StatCard'
import { useTablePagination } from '../../components/tablePagination'
import {
  NOT_STARTED_STAGE, dailyEffort, deckEffortTotals, effortCoverage, effortDayKey,
  efficiencySeries, hoursSeries, leadEfficiency, recordsWorkOnACoat, stageEfficiency, stageOrder,
  wasteReasons, type LeadEfficiency, type StageEfficiency, type WasteReason,
} from '../../domain/effort'
import { padDays } from '../../domain/daySeries'
import { deckForecast, type DeckForecast } from '../../domain/forecast'
import { computeDeckProgress } from '../../domain/progress'
import type { DeckEvent, WorkModel } from '../../domain/types'
import { DEFAULT_UNIT, perUnit } from '../../domain/unit'
import { formatAreaM2, formatHours, formatMhrPerM2, formatPercent } from '../../lib/format'
import { matchesSearch } from '../../lib/search'
import { fieldError, palette } from '../../theme'
import { useTypeScale } from '../../components/typeScale'
import { useFieldNarrowPhone, useFieldPhone } from '../gs/fieldSections'
import { EfficiencyLineChart, HoursBarChart } from './charts'
import { dashboardWorkNames, resolveWork, type ProductivityFilters } from './productivityFilters'

/**
 * The productivity dashboard (Feedback Rv2, item 12): Mhr/m² by stage, by day
 * and by crew, and where the hours were lost. Presentational -- the screen
 * around it loads the project and picks the theme -- and the same component
 * for the admin, the foreman and the viewer: Linh asked for both to see it,
 * and nothing on it writes.
 *
 * Every figure comes from domain/effort.ts, the module the Năng suất sheet
 * reads too, so a number here matches the workbook the customer is handed.
 *
 * One WORK at a time, like the GS screen's work picker: the stage names the
 * events carry are only unique inside a work, and a chart line per stage
 * needs them unique.
 */

const FALLBACK_COLORS = ['#0A8175', '#F97316', '#2563EB', '#7C3AED', '#DB2777', '#65A30D']

const dash = '—'
const ratio = (n: number | null) => (n === null ? dash : formatMhrPerM2(n))
/**
 * Every table as wide as its content (MOB-01): a header never wraps, and on a
 * phone the table scrolls sideways inside its card rather than squeezing.
 */
const TABLE_SCROLL = { x: 'max-content' } as const

export function ProductivityDashboard({
  events,
  models,
  filters,
  version = 0,
}: {
  events: DeckEvent[]
  models: WorkModel[]
  /** What the screen's filter bar has applied (FLT-01, FLT-02). */
  filters: ProductivityFilters
  /** Counts the bar's applies: every apply sends the tables back to page 1 (FLT-02). */
  version?: number
}) {
  // The scale of the page this is on: the field's 14 on a field page (GS-10).
  const type = useTypeScale()
  const phone = useFieldPhone()
  /** On a phone the name column stays in view while the figures scroll under it (MOB-01). */
  const pin = phone ? ('left' as const) : undefined
  const narrowPhone = useFieldNarrowPhone()
  /** On a phone the cards go two to a row, one under 360 px (MOB-02). */
  const cardColumns = !phone
    ? 'repeat(auto-fit, minmax(200px, 1fr))'
    : narrowPhone ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))'
  const workNames = useMemo(() => dashboardWorkNames(models, events), [models, events])
  const workName = resolveWork(filters.work, workNames)
  /**
   * One work is always chosen here, so its unit labels every total and
   * efficiency figure (RV6-36). A work the events remember but the model no
   * longer has reads m², as everything did before 0036.
   */
  const unit = models.find((m) => m.work.name === workName)?.work.unit ?? DEFAULT_UNIT
  const deckName = filters.deck
  const range = filters.range

  const filtered = useMemo(() => {
    const from = range[0]?.format('YYYY-MM-DD') ?? null
    const to = range[1]?.format('YYYY-MM-DD') ?? null
    return events.filter((ev) => {
      if ((ev.workName ?? '') !== workName) return false
      if (deckName !== '' && ev.deckName !== deckName) return false
      const day = effortDayKey(ev.at)
      if (from !== null && day < from) return false
      if (to !== null && day > to) return false
      return true
    })
  }, [events, workName, deckName, range])

  /** Today, once per mount -- see DeckForecastPanel for why not per render. */
  const today = useMemo(() => effortDayKey(new Date().toISOString()), [])

  const order = useMemo(() => stageOrder(models), [models])
  const daily = useMemo(() => dailyEffort(filtered), [filtered])
  const stages = useMemo(() => stageEfficiency(daily, order), [daily, order])

  /**
   * Feedback Rv5, item 5, Q10 and RV5-35. Two buckets exist so that events
   * carrying no real label do not vanish: `NOT_STARTED_STAGE` collects the
   * moves back to nothing, and the blank lead name collects the updates where
   * the foreman left the box empty (442 of them in Linh's screenshot, all at
   * 0 Mhr and 0 m²). Neither is a công đoạn or a nhóm trưởng, and neither can
   * carry a Mhr/m² figure -- they are noise on a screen whose subject is
   * efficiency.
   *
   * The hours some of these rows DO carry are a mis-entry, not work: asked
   * about the 4,0 Mhr and 37,42 m² on `Chưa bắt đầu` in dev, Linh answered
   * "User cập nhật nhầm. Có công đoạn mới có giờ công." The modal used to
   * compel it by requiring hours for every choice in its coat picker; RV5-30
   * and RV5-34 stopped that, so no new row can be written this way. The rows
   * already recorded stay in the database untouched (RV5-33) -- they are the
   * customer's history, and repairing production data is the owner's call --
   * and simply stop being displayed.
   *
   * **The exclusion has to be made on every dimension this screen aggregates
   * on, not only on the stage.** RV5-31 dropped the bucket from `stages` only,
   * which is a filter on the STAGE dimension; `leadEfficiency` groups by crew,
   * `wasteReasons` groups by reason and `deckEffortTotals` groups by day, and
   * none of the three has a stage row to drop.
   * So the owner measured 370,0 Mhr and 280,73 m² in Theo nhóm trưởng and 10,0
   * giờ in Lý do hao phí against a header reading 366,0, 243,31 and 9,0.
   * Linh's rule is that hours exist only where a coat does, so the EVENT is
   * excluded as well as the row: hours attached to no coat belong in no
   * aggregate, not merely in no stage row.
   *
   * `coverage` stays over the unfiltered set on purpose: it counts how much of
   * the history carries hours at all, and a removal is a real update whether
   * or not its hours may enter an average.
   *
   * Filtered HERE, at each consumer, and NOT inside `domain/effort.ts`:
   * `deckForecast` reads `stageEfficiency` output to work out what is left, and
   * the report's history sheets must still list every event that happened.
   */
  const withCoat = useMemo(() => filtered.filter(recordsWorkOnACoat), [filtered])
  const leads = useMemo(() => leadEfficiency(withCoat), [withCoat])
  const reasons = useMemo(() => wasteReasons(withCoat), [withCoat])
  /** The two `hôm nay` cards aggregate on the DAY, so they are the third
   *  consumer with no stage row to drop and need the same exclusion. */
  const todayTotals = deckEffortTotals(withCoat, today)
  const coverage = effortCoverage(filtered)

  /** The stage half of the exclusion argued for above. */
  const visibleStages = useMemo(
    () => stages.filter((s) => s.stageName !== NOT_STARTED_STAGE),
    [stages],
  )

  // Over the VISIBLE rows: a header that does not add up to its own columns is
  // worse than either figure alone (RV5-31, replacing RV5-10).
  const totalHours = visibleStages.reduce((s, r) => s + r.totalHours, 0)
  const totalAreaM2 = visibleStages.reduce((s, r) => s + r.totalAreaM2, 0)
  const wasteHours = visibleStages.reduce((s, r) => s + r.wasteHours, 0)
  const overall = totalAreaM2 > 0 ? totalHours / totalAreaM2 : null
  const wasteShare = totalHours + wasteHours > 0 ? wasteHours / (totalHours + wasteHours) : null

  const [leadQuery, setLeadQuery] = useState('')
  const visibleLeads = useMemo(
    () => leads.filter((l) => l.leadName !== '' && matchesSearch(l.leadName, leadQuery)),
    [leads, leadQuery],
  )

  /**
   * What is left on each deck of the chosen work, and whether its deadline
   * holds (Feedback Rv2, item 13). One row per deck rather than a table per
   * deck: the question this screen is open for is which deck is in trouble.
   *
   * Measured on the work's WHOLE history, not on the date range in the filters:
   * a rate measured over three days does not become a different rate because
   * the reader narrowed the view.
   */
  const forecasts = useMemo(() => {
    const model = models.find((m) => m.work.name === workName)
    if (!model) return [] as Array<{ deckName: string; forecast: DeckForecast }>
    const ofWork = events.filter((ev) => (ev.workName ?? '') === workName)
    const efficiency = stageEfficiency(dailyEffort(ofWork), order)
    return model.decks
      .filter((entry) => deckName === '' || entry.deck.name === deckName)
      .map((entry) => ({
        deckName: entry.deck.name,
        forecast: deckForecast({
          totalAreaM2: entry.deck.totalAreaM2,
          stages: entry.stages,
          stageProgress: computeDeckProgress(entry.deck, entry.stages).stages,
          efficiency,
          deadline: entry.deadline ?? null,
          today,
        }),
      }))
  }, [models, workName, deckName, events, order, today])

  const stageColors = useMemo(() => {
    const colors = new Map<string, string>()
    for (const model of models) {
      if (model.work.name !== workName) continue
      for (const entry of model.decks) {
        for (const stage of entry.stages) {
          if (!colors.has(stage.name)) colors.set(stage.name, stage.color)
        }
      }
    }
    return (order.get(workName) ?? []).concat(stages.map((s) => s.stageName))
      .filter((name, i, all) => all.indexOf(name) === i)
      // This list IS the chart's set of lines, so dropping the placeholder
      // here is what keeps it off Hiệu suất theo ngày (RV5-09).
      .filter((name) => name !== NOT_STARTED_STAGE)
      .map((name, i) => ({ name, color: colors.get(name) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }))
  }, [models, workName, order, stages])

  // Any filter above the tables, and any apply of the bar, sends each of them back to page 1.
  const filterKey = [version, workName, deckName, range[0]?.format('YYYY-MM-DD'), range[1]?.format('YYYY-MM-DD')].join('|')
  const stagePagination = useTablePagination(visibleStages.length, filterKey)
  const forecastPagination = useTablePagination(forecasts.length, `${version}|${workName}|${deckName}`)
  const leadPagination = useTablePagination(visibleLeads.length, `${filterKey}|${leadQuery}`)
  const reasonPagination = useTablePagination(reasons.length, filterKey)

  // Nothing recorded anywhere in the project: say what to do, not "no data".
  const anyEffort = events.some((ev) => ev.effort.workHours !== null || (ev.effort.wasteHours ?? 0) > 0)
  if (!anyEffort) {
    return (
      <EmptyState
        title="Chưa có giờ công nào được ghi"
        description="GS nhập giờ công khi cập nhật ô; admin có thể bổ sung ở trang chi tiết sàn."
      />
    )
  }

  const stageColumns = [
    // With the work beside it, the two name the row together, and both stay pinned.
    ...(workNames.length > 1 ? [{ title: 'Công việc', dataIndex: 'workName' as const, fixed: pin }] : []),
    { title: 'Công đoạn', dataIndex: 'stageName' as const, fixed: pin },
    { title: 'Số ngày', dataIndex: 'days' as const, align: 'center' as const },
    { title: 'Tổng Mhr', align: 'center' as const, render: (_: unknown, r: StageEfficiency) => formatHours(r.totalHours) },
    { title: `Tổng ${unit}`, align: 'center' as const, render: (_: unknown, r: StageEfficiency) => formatAreaM2(r.totalAreaM2) },
    {
      title: <>{`Hiệu suất TB (${perUnit(unit)})`}<InfoTip text={`Hiệu suất trung bình là trung bình cộng của ${perUnit(unit)} từng ngày`} /></>,
      align: 'center' as const,
      render: (_: unknown, r: StageEfficiency) => ratio(r.avgMhrPerM2),
    },
    { title: 'Mhr TB/ngày', align: 'center' as const, render: (_: unknown, r: StageEfficiency) => (r.avgHoursPerDay === null ? dash : formatHours(r.avgHoursPerDay)) },
    { title: 'Giờ hao phí', align: 'center' as const, render: (_: unknown, r: StageEfficiency) => formatHours(r.wasteHours) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        data-testid="dashboard-cards"
        style={{ display: 'grid', gridTemplateColumns: cardColumns, gap: 12 }}
      >
        <StatCard compact={phone} label="Tổng Mhr thực hiện" value={formatHours(totalHours)} />
        <StatCard compact={phone} label={`Tổng ${unit} đã ghi giờ công`} value={formatAreaM2(totalAreaM2)} sub={unit} />
        <StatCard
          compact={phone}
          label={<>{`${perUnit(unit)} tổng thể`}<InfoTip text={`Tổng Mhr chia tổng ${unit}, khác với hiệu suất trung bình theo ngày`} /></>}
          value={ratio(overall)}
          tone="accent"
        />
        {/* Today, beside the totals (Linh, 2026-09-05): the same two figures
            for the day the reader is standing in. */}
        <StatCard compact={phone} label="Mhr thực hiện hôm nay" value={formatHours(todayTotals.todayHours)} />
        <StatCard compact={phone} label="Mhr hao phí hôm nay" value={formatHours(todayTotals.todayWasteHours)} />
        <StatCard
          compact={phone}
          label="Giờ hao phí"
          value={formatHours(wasteHours)}
          sub={wasteShare === null ? dash : `${formatPercent(wasteShare)} tổng giờ`}
        />
      </div>

      <Typography.Text
        data-testid="dashboard-coverage"
        type={coverage.withHours < coverage.total ? 'warning' : 'secondary'}
      >
        {`${coverage.withHours} / ${coverage.total} lần cập nhật có ghi giờ công.`}
        <InfoTip text="Các lần chưa ghi không tính vào hiệu suất." />
      </Typography.Text>

      <SectionCard title="Hiệu suất theo công đoạn" bodyPadding={0}>
        <div data-testid="stage-table">
          <Table<StageEfficiency>
            size="small"
            rowKey={(r) => `${r.workName}/${r.stageName}`}
            pagination={stagePagination}
            dataSource={visibleStages}
            scroll={TABLE_SCROLL}
            columns={stageColumns}
            locale={{ emptyText: 'Không có lần cập nhật nào trong khoảng đã chọn' }}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Dự báo tiến độ"
        bodyPadding={0}
      >
        <div data-testid="forecast-table">
          <Table<{ deckName: string; forecast: DeckForecast }>
            size="small"
            rowKey="deckName"
            pagination={forecastPagination}
            dataSource={forecasts}
            scroll={TABLE_SCROLL}
            locale={{ emptyText: 'Chưa có sàn nào trong công việc này' }}
            columns={[
              { title: 'Sàn', dataIndex: 'deckName', fixed: pin },
              {
                title: 'Mhr còn cần',
                align: 'center',
                render: (_, r) => (r.forecast.totalMhrNeeded === null ? dash : formatHours(r.forecast.totalMhrNeeded)),
              },
              {
                title: <>Số ngày cần<InfoTip text="Số ngày của sàn là ngày lớn nhất trong các công đoạn vì các lớp làm song song" /></>,
                align: 'center',
                render: (_, r) => (r.forecast.daysNeeded === null ? dash : String(r.forecast.daysNeeded)),
              },
              {
                title: 'Hạn hoàn thành',
                align: 'center',
                // A date, so centred like every other date column (UI-03).
                render: (_, r) => (r.forecast.deadline === null ? dash : dayjs(r.forecast.deadline).format('DD/MM/YYYY')),
              },
              {
                title: 'Ngày còn lại',
                align: 'center',
                render: (_, r) => (r.forecast.daysRemaining === null ? dash : String(r.forecast.daysRemaining)),
              },
              {
                title: 'Cảnh báo',
                align: 'center',
                render: (_, r) => (r.forecast.lateDays === null
                  ? ''
                  : (
                    <span style={{ ...type.body, color: fieldError }}>
                      {`Trễ ${r.forecast.lateDays} ngày · thiếu ${formatHours(r.forecast.shortfallMhr ?? 0)} Mhr`}
                    </span>
                  )),
              },
            ]}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Hiệu suất theo ngày"
      >
        {/*
          Padded to every calendar day (QA F4): the series only has the days
          with data, and an axis of those alone spaced 27/08, 30/08 and 05/09
          evenly. The tables above keep the unpadded figures.
        */}
        <EfficiencyLineChart data={padDays(efficiencySeries(daily))} stages={stageColors} unit={unit} />
      </SectionCard>

      <SectionCard title="Giờ công theo ngày">
        <HoursBarChart data={padDays(hoursSeries(daily))} />
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <SectionCard
          title="Theo nhóm trưởng"
          bodyPadding={0}
          extra={
            <Input
              allowClear
              aria-label="Tìm nhóm trưởng"
              placeholder="Tìm nhóm trưởng"
              prefix={<SearchOutlined aria-hidden />}
              style={{ width: 200 }}
              value={leadQuery}
              onChange={(e) => setLeadQuery(e.target.value)}
            />
          }
        >
          <div data-testid="lead-table">
            <Table<LeadEfficiency>
              size="small"
              rowKey="leadName"
              pagination={leadPagination}
              dataSource={visibleLeads}
              scroll={TABLE_SCROLL}
              locale={{ emptyText: 'Không có nhóm trưởng nào khớp' }}
              columns={[
                { title: 'Nhóm trưởng', dataIndex: 'leadName', fixed: pin },
                { title: 'Lần cập nhật', dataIndex: 'updates', align: 'center' },
                { title: 'Tổng Mhr', align: 'center', render: (_, r) => formatHours(r.totalHours) },
                { title: `Tổng ${unit}`, align: 'center', render: (_, r) => formatAreaM2(r.totalAreaM2) },
                { title: perUnit(unit), align: 'center', render: (_, r) => ratio(r.mhrPerM2) },
                { title: 'Giờ hao phí', align: 'center', render: (_, r) => formatHours(r.wasteHours) },
              ]}
            />
          </div>
        </SectionCard>
        <SectionCard title="Lý do hao phí" bodyPadding={0}>
          <div data-testid="waste-table">
            <Table<WasteReason>
              size="small"
              rowKey="reason"
              pagination={reasonPagination}
              dataSource={reasons}
              scroll={TABLE_SCROLL}
              columns={[
                {
                  // A note, not a category (UI-04 amended): plain text, left like every note (UI-03).
                  title: 'Lý do',
                  dataIndex: 'reason',
                  fixed: pin,
                  render: (v: string) => (v === '' ? <span style={{ color: palette.textQuaternary }}>Không ghi lý do</span> : v),
                },
                { title: 'Giờ', align: 'center', render: (_, r) => formatHours(r.hours) },
                { title: 'Số lần', dataIndex: 'count', align: 'center' },
              ]}
              locale={{ emptyText: 'Chưa ghi giờ hao phí nào' }}
            />
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
