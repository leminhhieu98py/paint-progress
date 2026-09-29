import { Alert, App, Button, DatePicker, Select, Table, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SectionCard } from '../../components/SectionCard'
import { InfoTip } from '../../components/InfoTip'
import { WORK_SELECT_WIDTH, searchSelectProps, useFullOptionsProps } from '../../components/searchSelect'
import { StatCard } from '../../components/StatCard'
import { useTablePagination } from '../../components/tablePagination'
import {
  dailyEffort, deckEffortTotals, effortDayKey, stageEfficiency, stageOrder,
} from '../../domain/effort'
import { deckForecast, type StageForecast } from '../../domain/forecast'
import { computeDeckProgress } from '../../domain/progress'
import type { DeckEvent, WorkModel } from '../../domain/types'
import { DEFAULT_UNIT, perUnit } from '../../domain/unit'
import { MISSING, formatAreaM2, formatHours, formatMhrPerM2 } from '../../lib/format'
import { loadDeckWorks, type DeckWorks } from '../../lib/progressApi'
import { setWorkDeckDeadline } from '../../lib/worksApi'
import { palette, space, type } from '../../theme'

/** The deck-wide totals' notes, on their labels' (?) (CPY-01). */
const DECK_WIDE = 'Cả sàn, mọi công việc'
const NOT_IN_EFFICIENCY = 'Không tính vào hiệu suất'

/**
 * What is left on this deck and whether its deadline is reachable (Feedback
 * Rv2, item 13), plus the four figures Linh asked to see beside it: the hours
 * worked and lost today, and the same two for the whole job.
 *
 * Per (deck, work), which is where the deadline lives (0031) and where the
 * coats live: one deck under both "Sơn" and "Tháo giáo" has two schedules.
 *
 * The events are handed in rather than read here: the effort history panel on
 * the same screen already reads them, and a deck like Main Deck carries over a
 * thousand. The deck's works are read here, because nothing else on the screen
 * exposes the deadline.
 */

const dash = MISSING

export function DeckForecastPanel({
  deckId,
  editable,
  events,
}: {
  deckId: string
  editable: boolean
  /** Every stage change on the deck, oldest first. Null while loading. */
  events: DeckEvent[] | null
}) {
  const { message } = App.useApp()
  // The work select's options read in full, as every work select's (M5).
  const fullOptions = useFullOptionsProps()
  const [deckWorks, setDeckWorks] = useState<DeckWorks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [workId, setWorkId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadDeckWorks(deckId)
      .then((dw) => {
        if (cancelled) return
        setError(null)
        setDeckWorks(dw)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [deckId, attempt])

  const works = deckWorks?.works ?? []
  const activeWork = works.find((w) => w.work.id === workId) ?? works[0] ?? null
  /** The forecast is one work's, so its unit heads the columns (RV6-35). */
  const unit = activeWork?.work.unit ?? DEFAULT_UNIT

  /** The work as a model, so the shared effort and progress functions apply. */
  const models = useMemo<WorkModel[]>(() => (deckWorks
    ? deckWorks.works.map((w) => ({
      work: w.work,
      decks: [{ deck: { ...deckWorks.deck, cells: w.cells }, stages: w.stages, weight: w.weight }],
    }))
    : []), [deckWorks])

  /**
   * Today, once per mount. Reading the clock during render makes the component
   * impure -- two renders a millisecond apart could disagree across midnight --
   * and it is a dependency of the forecast below. A screen left open overnight
   * keeps yesterday's "hôm nay" until it is reloaded, which is what a screen
   * left open overnight does with every other figure on it too.
   */
  const today = useMemo(() => effortDayKey(new Date().toISOString()), [])
  const totals = deckEffortTotals(events ?? [], today)

  const forecast = useMemo(() => {
    if (!deckWorks || !activeWork) return null
    const order = stageOrder(models)
    const mine = stageEfficiency(dailyEffort(events ?? []), order)
      .filter((e) => e.workName === activeWork.work.name)
    const progress = computeDeckProgress(
      { ...deckWorks.deck, cells: activeWork.cells },
      activeWork.stages,
    )
    return deckForecast({
      totalAreaM2: deckWorks.deck.totalAreaM2,
      stages: activeWork.stages,
      stageProgress: progress.stages,
      efficiency: mine,
      deadline: activeWork.deadline,
      today,
    })
  }, [deckWorks, activeWork, models, events, today])

  /**
   * The last date written, and when.
   *
   * antd fires the picker's onChange TWICE for one keyboard entry -- once when
   * the text parses and once on Enter -- and the second fires before the write
   * has come back, so comparing against the loaded deadline alone writes the
   * same date twice. A ref rather than state because the second call happens in
   * the same tick, before any re-render could have seen a flag.
   */
  const lastWrite = useRef<{ value: string | null; at: number } | null>(null)

  const saveDeadline = async (value: Dayjs | null) => {
    if (!activeWork) return
    const next = value ? value.format('YYYY-MM-DD') : null
    // A change that changes nothing is not a write.
    if (next === (activeWork.deadline ?? null)) return
    const last = lastWrite.current
    if (last !== null && last.value === next && Date.now() - last.at < 2000) return
    lastWrite.current = { value: next, at: Date.now() }
    setSaving(true)
    try {
      await setWorkDeckDeadline(activeWork.work.id, deckId, next)
      message.success(next ? 'Đã lưu hạn hoàn thành' : 'Đã xoá hạn hoàn thành')
      setAttempt((n) => n + 1)
    } catch (e) {
      // The write did not land, so a retry with the same date is a real write.
      lastWrite.current = null
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // The deck is part of the scope: one work spans every deck, and this panel
  // stays mounted from one deck to the next.
  const pagination = useTablePagination(forecast?.stages.length ?? 0, `${deckId}|${activeWork?.work.id ?? ''}`)
  const facts = activeWork === null
    ? undefined
    : [
      { value: activeWork.work.name },
      activeWork.deadline
        ? { prefix: 'hạn', value: dayjs(activeWork.deadline).format('DD/MM/YYYY') }
        : { label: 'chưa đặt hạn' },
    ]

  return (
    <SectionCard code="A3.8" title="Dự báo tiến độ" facts={facts} bodyPadding={0}>
      {/*
        Flush body, so the table's edge columns carry the card's inset (LAY-01);
        the blocks above and below it take the same inset themselves.
      */}
      <div style={{ padding: `${space.lg}px ${space.xl}px` }}>
      {error && (
        <Alert
          type="error"
          showIcon
          message="Không tải được công việc của sàn"
          description={error}
          action={<Button onClick={() => setAttempt((n) => n + 1)}>Thử lại</Button>}
          style={{ marginBottom: 12 }}
        />
      )}

      {/*
        The four deck figures Linh asked for, before anything is forecast: what
        the deck cost today and what it has cost so far. Deck-wide across every
        work, unlike the table below -- "tổng Mhr của sàn" is a question about
        the deck.
      */}
      <div
        data-testid="deck-effort-totals"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatCard label={<>Mhr thực hiện hôm nay<InfoTip text={DECK_WIDE} /></>} value={formatHours(totals.todayHours)} tone="accent" />
        <StatCard label={<>Mhr thực hiện đến nay<InfoTip text={DECK_WIDE} /></>} value={formatHours(totals.totalHours)} />
        <StatCard label={<>Mhr hao phí hôm nay<InfoTip text={NOT_IN_EFFICIENCY} /></>} value={formatHours(totals.todayWasteHours)} />
        <StatCard label={<>Mhr hao phí đến nay<InfoTip text={NOT_IN_EFFICIENCY} /></>} value={formatHours(totals.totalWasteHours)} />
      </div>

      {/* The work, from a searchable select named by its aria-label (FLT-01, FLT-03). */}
      {works.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Select
            aria-label="Công việc · Dự báo tiến độ"
            {...searchSelectProps}
            {...fullOptions}
            style={{ width: WORK_SELECT_WIDTH }}
            value={activeWork?.work.id}
            onChange={(id: string) => setWorkId(id)}
            options={works.map((w) => ({ label: w.work.name, value: w.work.id }))}
          />
        </div>
      )}

      {activeWork === null ? (
        <Typography.Text type="secondary">
          Sàn này chưa thuộc công việc nào.
        </Typography.Text>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label htmlFor="deck-deadline" style={{ ...type.label, color: palette.textTertiary }}>
              Hạn hoàn thành
            </label>
            {editable ? (
              <DatePicker
                id="deck-deadline"
                format="DD/MM/YYYY"
                allowClear
                disabled={saving}
                value={activeWork.deadline ? dayjs(activeWork.deadline) : null}
                onChange={(v) => void saveDeadline(v)}
                placeholder="Chọn ngày"
              />
            ) : (
              <span data-testid="deck-deadline-readonly" style={type.body}>
                {activeWork.deadline ? dayjs(activeWork.deadline).format('DD/MM/YYYY') : dash}
              </span>
            )}
            {forecast?.daysRemaining !== null && forecast !== null && (
              <span style={{ ...type.caption, color: palette.textSecondary }}>
                {forecast.daysRemaining > 0
                  ? <>{`Còn ${forecast.daysRemaining} ngày`}<InfoTip text="Tính cả chủ nhật" /></>
                  : `Đã quá hạn ${1 - forecast.daysRemaining} ngày`}
              </span>
            )}
          </div>

          {forecast !== null && forecast.lateDays !== null && (
            <Alert
              data-testid="forecast-warning"
              type="error"
              showIcon
              style={{ marginTop: space.lg }}
              message="Cảnh báo không kịp tiến độ"
              description={
                `Cần thêm ${formatHours(forecast.shortfallMhr ?? 0)} Mhr hoặc ${forecast.lateDays} ngày làm việc.`
              }
            />
          )}
        </>
      )}
      </div>

      {activeWork !== null && (
        <>
          <Table<StageForecast>
            data-testid="forecast-table"
            size="small"
            rowKey="stageId"
            pagination={pagination}
            loading={events === null}
            dataSource={forecast?.stages ?? []}
            locale={{ emptyText: 'Công việc này chưa có công đoạn nào trên sàn' }}
            columns={[
              { title: 'Công đoạn', dataIndex: 'stageName' },
              {
                title: `${unit} còn lại`,
                align: 'center',
                render: (_, r) => formatAreaM2(r.remainingAreaM2),
              },
              {
                title: `Hiệu suất TB (${perUnit(unit)})`,
                align: 'center',
                render: (_, r) => (r.avgMhrPerM2 === null ? dash : formatMhrPerM2(r.avgMhrPerM2)),
              },
              {
                title: 'Mhr TB/ngày',
                align: 'center',
                render: (_, r) => (r.avgHoursPerDay === null ? dash : formatHours(r.avgHoursPerDay)),
              },
              {
                title: 'Mhr còn cần',
                align: 'center',
                render: (_, r) => (r.mhrNeeded === null ? dash : formatHours(r.mhrNeeded)),
              },
              {
                title: <>Số ngày cần<InfoTip text="Số ngày của sàn là ngày lớn nhất trong các công đoạn, không phải tổng: các lớp thi công song song." /></>,
                align: 'center',
                render: (_, r) => (r.daysNeeded === null ? dash : String(r.daysNeeded)),
              },
            ]}
            summary={() => (
              <Table.Summary.Row data-testid="forecast-total">
                <Table.Summary.Cell index={0}>
                  <span style={type.bodyStrong}>Tổng</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center" />
                <Table.Summary.Cell index={2} align="center" />
                <Table.Summary.Cell index={3} align="center" />
                <Table.Summary.Cell index={4} align="center">
                  <span style={type.bodyStrong}>
                    {forecast?.totalMhrNeeded === null || forecast === null
                      ? dash
                      : formatHours(forecast.totalMhrNeeded)}
                  </span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="center">
                  <span style={type.bodyStrong}>{forecast?.daysNeeded === null || forecast === null ? dash : String(forecast.daysNeeded)}</span>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />

          {/*
            What the totals leave out, only when they leave something out. Why
            the total days is not the sum is the Số ngày cần header's (?).
          */}
          {forecast !== null && forecast.stagesWithoutData > 0 && (
            <div style={{ padding: `${space.sm}px ${space.xl}px ${space.xl}px`, ...type.caption, lineHeight: 1.5, color: palette.textTertiary }}>
              <div data-testid="forecast-missing">
                {`Tổng ở trên chưa gồm ${forecast.stagesWithoutData} công đoạn chưa có giờ công nào.`}
              </div>
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}
