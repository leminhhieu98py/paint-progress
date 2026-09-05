import { DatePicker, Segmented, Select, Table, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { SectionCard } from '../../components/SectionCard'
import { StatCard } from '../../components/StatCard'
import {
  dailyEffort, deckEffortTotals, effortCoverage, effortDayKey, efficiencySeries, hoursSeries,
  leadEfficiency, stageEfficiency, stageOrder, wasteReasons,
  type LeadEfficiency, type StageEfficiency, type WasteReason,
} from '../../domain/effort'
import { deckForecast, type DeckForecast } from '../../domain/forecast'
import { computeDeckProgress } from '../../domain/progress'
import type { DeckEvent, WorkModel } from '../../domain/types'
import { formatAreaM2, formatHours, formatMhrPerM2, formatPercent } from '../../lib/format'
import { fieldError, palette } from '../../theme'
import { EfficiencyLineChart, HoursBarChart } from './charts'

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

export function ProductivityDashboard({
  events,
  models,
  decks,
}: {
  events: DeckEvent[]
  models: WorkModel[]
  decks: { id: string; name: string }[]
}) {
  const workNames = useMemo(() => {
    const fromModels = [...models]
      .filter((m) => m.work.kind === 'bays')
      .sort((a, b) => a.work.seq - b.work.seq)
      .map((m) => m.work.name)
    // A work the events remember but the model no longer has (renamed,
    // deleted) still holds hours somebody typed; it stays selectable.
    for (const ev of events) {
      const name = ev.workName ?? ''
      if (!fromModels.includes(name)) fromModels.push(name)
    }
    return fromModels
  }, [models, events])

  const [workChoice, setWorkChoice] = useState<string | null>(null)
  const workName = workChoice !== null && workNames.includes(workChoice) ? workChoice : workNames[0] ?? ''
  const [deckName, setDeckName] = useState<string>('')
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null]>([null, null])

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
  const todayTotals = deckEffortTotals(filtered, today)

  const order = useMemo(() => stageOrder(models), [models])
  const daily = useMemo(() => dailyEffort(filtered), [filtered])
  const stages = useMemo(() => stageEfficiency(daily, order), [daily, order])
  const leads = useMemo(() => leadEfficiency(filtered), [filtered])
  const reasons = useMemo(() => wasteReasons(filtered), [filtered])
  const coverage = effortCoverage(filtered)

  const totalHours = stages.reduce((s, r) => s + r.totalHours, 0)
  const totalAreaM2 = stages.reduce((s, r) => s + r.totalAreaM2, 0)
  const wasteHours = stages.reduce((s, r) => s + r.wasteHours, 0)
  const overall = totalAreaM2 > 0 ? totalHours / totalAreaM2 : null
  const wasteShare = totalHours + wasteHours > 0 ? wasteHours / (totalHours + wasteHours) : null

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
      .map((name, i) => ({ name, color: colors.get(name) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }))
  }, [models, workName, order, stages])

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
    ...(workNames.length > 1 ? [{ title: 'Công việc', dataIndex: 'workName' as const }] : []),
    { title: 'Công đoạn', dataIndex: 'stageName' as const },
    { title: 'Số ngày', dataIndex: 'days' as const, align: 'right' as const },
    { title: 'Tổng Mhr', align: 'right' as const, render: (_: unknown, r: StageEfficiency) => formatHours(r.totalHours) },
    { title: 'Tổng m²', align: 'right' as const, render: (_: unknown, r: StageEfficiency) => formatAreaM2(r.totalAreaM2) },
    { title: 'Hiệu suất TB (Mhr/m²)', align: 'right' as const, render: (_: unknown, r: StageEfficiency) => ratio(r.avgMhrPerM2) },
    { title: 'Mhr TB/ngày', align: 'right' as const, render: (_: unknown, r: StageEfficiency) => (r.avgHoursPerDay === null ? dash : formatHours(r.avgHoursPerDay)) },
    { title: 'Giờ hao phí', align: 'right' as const, render: (_: unknown, r: StageEfficiency) => formatHours(r.wasteHours) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div data-testid="dashboard-filters" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {workNames.length > 1 && (
          <Segmented
            value={workName}
            onChange={(v) => setWorkChoice(String(v))}
            options={workNames.map((name) => ({ label: name === '' ? '(không rõ công việc)' : name, value: name }))}
          />
        )}
        <Select
          aria-label="Sàn"
          style={{ width: 220 }}
          value={deckName}
          onChange={setDeckName}
          options={[{ value: '', label: 'Tất cả sàn' }, ...decks.map((d) => ({ value: d.name, label: d.name }))]}
        />
        <DatePicker.RangePicker
          allowEmpty={[true, true]}
          format="DD/MM/YYYY"
          placeholder={['Từ ngày', 'Đến ngày']}
          value={range}
          onCalendarChange={(dates) => setRange([dates?.[0] ?? null, dates?.[1] ?? null])}
        />
      </div>

      <div
        data-testid="dashboard-cards"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}
      >
        <StatCard label="Tổng Mhr thực hiện" value={formatHours(totalHours)} sub="giờ công đã ghi" />
        <StatCard label="Tổng m² đã ghi giờ công" value={formatAreaM2(totalAreaM2)} sub="m²" />
        <StatCard
          label="Mhr/m² tổng thể"
          value={ratio(overall)}
          sub="tổng Mhr chia tổng m², khác với hiệu suất trung bình theo ngày"
          tone="accent"
        />
        {/* Today, beside the totals (Linh, 2026-09-05): the same two figures
            for the day the reader is standing in. */}
        <StatCard label="Mhr thực hiện hôm nay" value={formatHours(todayTotals.todayHours)} sub="theo bộ lọc trên" />
        <StatCard label="Mhr hao phí hôm nay" value={formatHours(todayTotals.todayWasteHours)} sub="theo bộ lọc trên" />
        <StatCard
          label="Giờ hao phí"
          value={formatHours(wasteHours)}
          sub={wasteShare === null ? dash : `${formatPercent(wasteShare)} tổng giờ`}
        />
      </div>

      <Typography.Text
        data-testid="dashboard-coverage"
        type={coverage.withHours < coverage.total ? 'warning' : 'secondary'}
      >
        {`${coverage.withHours} / ${coverage.total} lần cập nhật có ghi giờ công. Các lần chưa ghi không tính vào hiệu suất.`}
      </Typography.Text>

      <SectionCard title="Hiệu suất theo công đoạn" bodyPadding={0}>
        <div data-testid="stage-table">
          <Table<StageEfficiency>
            size="small"
            rowKey={(r) => `${r.workName}/${r.stageName}`}
            pagination={false}
            dataSource={stages}
            columns={stageColumns}
            locale={{ emptyText: 'Không có lần cập nhật nào trong khoảng đã chọn' }}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Dự báo tiến độ"
        summary="Còn lại bao nhiêu và có kịp hạn không; số ngày của sàn là ngày lớn nhất trong các công đoạn vì các lớp làm song song"
        bodyPadding={0}
      >
        <div data-testid="forecast-table">
          <Table<{ deckName: string; forecast: DeckForecast }>
            size="small"
            rowKey="deckName"
            pagination={false}
            dataSource={forecasts}
            locale={{ emptyText: 'Chưa có sàn nào trong công việc này' }}
            columns={[
              { title: 'Sàn', dataIndex: 'deckName' },
              {
                title: 'Mhr còn cần',
                align: 'right',
                render: (_, r) => (r.forecast.totalMhrNeeded === null ? dash : formatHours(r.forecast.totalMhrNeeded)),
              },
              {
                title: 'Số ngày cần',
                align: 'right',
                render: (_, r) => (r.forecast.daysNeeded === null ? dash : String(r.forecast.daysNeeded)),
              },
              {
                title: 'Hạn hoàn thành',
                align: 'right',
                render: (_, r) => (r.forecast.deadline === null ? dash : dayjs(r.forecast.deadline).format('DD/MM/YYYY')),
              },
              {
                title: 'Ngày còn lại',
                align: 'right',
                render: (_, r) => (r.forecast.daysRemaining === null ? dash : String(r.forecast.daysRemaining)),
              },
              {
                title: 'Cảnh báo',
                render: (_, r) => (r.forecast.lateDays === null
                  ? ''
                  : (
                    <span style={{ color: fieldError, fontWeight: 600 }}>
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
        summary="Mhr/m² của từng công đoạn theo ngày; hiệu suất trung bình là trung bình cộng của các điểm này"
      >
        <EfficiencyLineChart data={efficiencySeries(daily)} stages={stageColors} />
      </SectionCard>

      <SectionCard title="Giờ công theo ngày" summary="Giờ thực hiện và giờ hao phí, cộng dồn mọi công đoạn">
        <HoursBarChart data={hoursSeries(daily)} />
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <SectionCard title="Theo nhóm trưởng" bodyPadding={0}>
          <div data-testid="lead-table">
            <Table<LeadEfficiency>
              size="small"
              rowKey="leadName"
              pagination={false}
              dataSource={leads}
              columns={[
                {
                  title: 'Nhóm trưởng',
                  dataIndex: 'leadName',
                  render: (v: string) => (v === '' ? <span style={{ color: palette.textQuaternary }}>Chưa ghi</span> : v),
                },
                { title: 'Lần cập nhật', dataIndex: 'updates', align: 'right' },
                { title: 'Tổng Mhr', align: 'right', render: (_, r) => formatHours(r.totalHours) },
                { title: 'Tổng m²', align: 'right', render: (_, r) => formatAreaM2(r.totalAreaM2) },
                { title: 'Mhr/m²', align: 'right', render: (_, r) => ratio(r.mhrPerM2) },
                { title: 'Giờ hao phí', align: 'right', render: (_, r) => formatHours(r.wasteHours) },
              ]}
            />
          </div>
        </SectionCard>
        <SectionCard title="Lý do hao phí" bodyPadding={0}>
          <div data-testid="waste-table">
            <Table<WasteReason>
              size="small"
              rowKey="reason"
              pagination={false}
              dataSource={reasons}
              columns={[
                {
                  title: 'Lý do',
                  dataIndex: 'reason',
                  render: (v: string) => (v === '' ? <span style={{ color: palette.textQuaternary }}>Không ghi lý do</span> : v),
                },
                { title: 'Giờ', align: 'right', render: (_, r) => formatHours(r.hours) },
                { title: 'Số lần', dataIndex: 'count', align: 'right' },
              ]}
              locale={{ emptyText: 'Chưa ghi giờ hao phí nào' }}
            />
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
