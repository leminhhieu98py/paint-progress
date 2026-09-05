import { Alert, App, Button, DatePicker, Segmented, Table, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SectionCard } from '../../components/SectionCard'
import { StatCard } from '../../components/StatCard'
import {
  dailyEffort, deckEffortTotals, effortDayKey, stageEfficiency, stageOrder,
} from '../../domain/effort'
import { deckForecast, type StageForecast } from '../../domain/forecast'
import { computeDeckProgress } from '../../domain/progress'
import type { DeckEvent, WorkModel } from '../../domain/types'
import { formatAreaM2, formatHours, formatMhrPerM2 } from '../../lib/format'
import { loadDeckWorks, type DeckWorks } from '../../lib/progressApi'
import { setWorkDeckDeadline } from '../../lib/worksApi'
import { palette } from '../../theme'

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

const dash = '—'

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
        // Whatever the server says is now the truth; anything this panel was
        // waiting for has either landed or been overtaken.
        requested.current = undefined
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

  /** The work as a model, so the shared effort and progress functions apply. */
  const models = useMemo<WorkModel[]>(() => (deckWorks
    ? deckWorks.works.map((w) => ({
      work: w.work,
      decks: [{ deck: { ...deckWorks.deck, cells: w.cells }, stages: w.stages, weight: w.weight }],
    }))
    : []), [deckWorks])

  const today = effortDayKey(new Date().toISOString())
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
   * The date this panel has asked the server for but has not read back yet.
   *
   * A ref, not state, because it has to be true for the NEXT onChange in the
   * same tick: antd fires the picker's onChange twice for one keyboard entry
   * (on the parse and on Enter), and a state flag set in the first has not
   * re-rendered by the second. Without it the same date is written twice, and
   * once the reload lands the picker fires again on the value it was handed --
   * which is a write loop, not a save.
   */
  const requested = useRef<string | null | undefined>(undefined)

  const saveDeadline = async (value: Dayjs | null) => {
    if (!activeWork) return
    const next = value ? value.format('YYYY-MM-DD') : null
    const current = requested.current === undefined ? activeWork.deadline ?? null : requested.current
    // A change that changes nothing is not a write.
    if (next === current) return
    requested.current = next
    setSaving(true)
    try {
      await setWorkDeckDeadline(activeWork.work.id, deckId, next)
      message.success(next ? 'Đã lưu hạn hoàn thành' : 'Đã xoá hạn hoàn thành')
      setAttempt((n) => n + 1)
    } catch (e) {
      // The write did not land, so the panel is not waiting for it either.
      requested.current = undefined
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const summary = activeWork === null
    ? undefined
    : activeWork.deadline
      ? `${activeWork.work.name} · hạn ${dayjs(activeWork.deadline).format('DD/MM/YYYY')}`
      : `${activeWork.work.name} · chưa đặt hạn`

  return (
    <SectionCard code="A3.6" title="Dự báo tiến độ" summary={summary}>
      {error && (
        <Alert
          type="error"
          showIcon
          message="Không tải được công việc của sàn"
          description={error}
          action={<Button size="small" onClick={() => setAttempt((n) => n + 1)}>Thử lại</Button>}
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
        <StatCard label="Mhr thực hiện hôm nay" value={formatHours(totals.todayHours)} sub="cả sàn, mọi công việc" tone="accent" />
        <StatCard label="Mhr thực hiện đến nay" value={formatHours(totals.totalHours)} sub="cả sàn, mọi công việc" />
        <StatCard label="Mhr hao phí hôm nay" value={formatHours(totals.todayWasteHours)} sub="không tính vào hiệu suất" />
        <StatCard label="Mhr hao phí đến nay" value={formatHours(totals.totalWasteHours)} sub="không tính vào hiệu suất" />
      </div>

      {works.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>Công việc</span>
          <Segmented
            value={activeWork?.work.id}
            onChange={(v) => setWorkId(String(v))}
            options={works.map((w) => ({ label: w.work.name, value: w.work.id }))}
          />
        </div>
      )}

      {activeWork === null ? (
        <Typography.Text type="secondary">
          Sàn này chưa thuộc công việc nào, nên chưa có gì để dự báo.
        </Typography.Text>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <label htmlFor="deck-deadline" style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>
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
              <span data-testid="deck-deadline-readonly" style={{ fontWeight: 600 }}>
                {activeWork.deadline ? dayjs(activeWork.deadline).format('DD/MM/YYYY') : dash}
              </span>
            )}
            {forecast?.daysRemaining !== null && forecast !== null && (
              <span style={{ fontSize: 12, color: palette.textSecondary }}>
                {forecast.daysRemaining > 0
                  ? `Còn ${forecast.daysRemaining} ngày (tính cả chủ nhật)`
                  : `Đã quá hạn ${1 - forecast.daysRemaining} ngày`}
              </span>
            )}
          </div>

          {forecast !== null && forecast.lateDays !== null && (
            <Alert
              data-testid="forecast-warning"
              type="error"
              showIcon
              style={{ marginBottom: 14 }}
              message="Cảnh báo không kịp tiến độ"
              description={
                `Cần thêm ${formatHours(forecast.shortfallMhr ?? 0)} Mhr hoặc ${forecast.lateDays} ngày làm việc.`
              }
            />
          )}

          <Table<StageForecast>
            data-testid="forecast-table"
            size="small"
            rowKey="stageId"
            pagination={false}
            loading={events === null}
            dataSource={forecast?.stages ?? []}
            locale={{ emptyText: 'Công việc này chưa có công đoạn nào trên sàn' }}
            columns={[
              { title: 'Công đoạn', dataIndex: 'stageName' },
              {
                title: 'm² còn lại',
                align: 'right',
                render: (_, r) => formatAreaM2(r.remainingAreaM2),
              },
              {
                title: 'Hiệu suất TB (Mhr/m²)',
                align: 'right',
                render: (_, r) => (r.avgMhrPerM2 === null ? dash : formatMhrPerM2(r.avgMhrPerM2)),
              },
              {
                title: 'Mhr TB/ngày',
                align: 'right',
                render: (_, r) => (r.avgHoursPerDay === null ? dash : formatHours(r.avgHoursPerDay)),
              },
              {
                title: 'Mhr còn cần',
                align: 'right',
                render: (_, r) => (r.mhrNeeded === null ? dash : formatHours(r.mhrNeeded)),
              },
              {
                title: 'Số ngày cần',
                align: 'right',
                render: (_, r) => (r.daysNeeded === null ? dash : String(r.daysNeeded)),
              },
            ]}
            summary={() => (
              <Table.Summary.Row data-testid="forecast-total">
                <Table.Summary.Cell index={0}>
                  <strong>Tổng</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right" />
                <Table.Summary.Cell index={2} align="right" />
                <Table.Summary.Cell index={3} align="right" />
                <Table.Summary.Cell index={4} align="right">
                  <strong>
                    {forecast?.totalMhrNeeded === null || forecast === null
                      ? dash
                      : formatHours(forecast.totalMhrNeeded)}
                  </strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <strong>{forecast?.daysNeeded === null || forecast === null ? dash : String(forecast.daysNeeded)}</strong>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />

          <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5, color: palette.textTertiary }}>
            {/*
              Two sentences the numbers cannot say for themselves: why the
              total days is not the sum, and what the totals leave out.
            */}
            <div>
              Số ngày của sàn là ngày lớn nhất trong các công đoạn, không phải tổng: các lớp thi công song song.
            </div>
            {forecast !== null && forecast.stagesWithoutData > 0 && (
              <div data-testid="forecast-missing" style={{ marginTop: 3 }}>
                {`${forecast.stagesWithoutData} công đoạn chưa có giờ công nào nên chưa dự báo được; tổng ở trên chưa gồm các công đoạn đó.`}
              </div>
            )}
          </div>
        </>
      )}
    </SectionCard>
  )
}
