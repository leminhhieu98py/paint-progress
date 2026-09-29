import { InfoTip } from '../../components/InfoTip'
import { SectionCard } from '../../components/SectionCard'
import type { DeckEffortTotals } from '../../domain/effort'
import type { TodayStageArea } from '../../domain/today'
import { DEFAULT_UNIT } from '../../domain/unit'
import { formatAreaM2, formatHours } from '../../lib/format'
import { fieldType, palette, space } from '../../theme'
import { CardSkeleton, type DeckFigureStatus } from './DeckStatsCards'

/** 'YYYY-MM-DD' as the paperwork writes it. See lib/format for why VN is a constant. */
const asVNDate = (dayKey: string): string => {
  const [y, m, d] = dayKey.split('-')
  return d && m && y ? `${d}/${m}/${y}` : dayKey
}

/**
 * The day this deck man-hours start from: migration 0030, 2026-09-05. Hard-coded
 * rather than derived, because it is a fact about the schema's history and there
 * is nothing on the client that could compute it.
 */
const EFFORT_SINCE = '05/09/2026'

/**
 * Thông tin nhanh — Hôm nay (Feedback Rv5, item 7).
 *
 * What this deck produced today, coat by coat, and what it cost in man-hours.
 * The foreman is standing on the deck with the tablet; the question "how much
 * did we get done today" should not need a trip to the dashboard on a laptop.
 *
 * Presentational: props in, no fetching, no filtering of its own. Two rules
 * shape it.
 *
 * RV5-17 -- every coat the admin configured on this deck is a row, and one
 * nobody touched today reads `0,00 m²` rather than being left out. Linh's words:
 * "Liệt kê đủ các công đoạn khi admin tạo sàn. nếu không làm thì hiển thị 0m2."
 *
 * RV5-18 -- the block is the DECK's, across every work it belongs to, and
 * ignores the work picker above the drawing ("Bảng thông tin nhanh hiển thị
 * theo sàn không liên quan công việc nào"). A deck in two works therefore gets
 * its coats grouped under the work name, because two coats called "Lớp 1" in
 * different works are two different coats. A deck in one work -- the ordinary
 * case -- gets no header: naming the only work there is is chrome.
 */
export function DeckTodayCard({
  status = 'ready',
  todayKey,
  rows,
  totals,
  emptyText = 'Sàn này chưa có công đoạn nào. Quản trị viên cần khai báo công đoạn trước khi ghi tiến độ.',
}: {
  /**
   * See DeckFigureStatus. Loading until both the deck's works (the rows) and
   * its events (the figures) are in; unknown when the events could not be read.
   */
  status?: DeckFigureStatus
  /** `effortDayKey` of now. Named on the card, so a tablet left open overnight
   *  cannot quietly report yesterday as today. */
  todayKey: string
  /**
   * Every coat of the deck, in seq order, with today's quantity. See
   * todayAreaByStage. `unit` is the row's work's (RV6-35): the rows span
   * every work of the deck, so each carries its own; absent reads as m².
   */
  rows: (TodayStageArea & { unit?: string })[]
  /** The four figures of RV5-19, straight from `deckEffortTotals`. */
  totals: DeckEffortTotals
  /**
   * What the card says with no rows. The default is for a deck whose works
   * have no coats; the caller names a failed read or a deck in no work, which
   * an admin's coat list would not fix (I2).
   */
  emptyText?: string
}) {
  /** Preserves `rows`' order; the caller owns seq order. */
  const groups: { workName: string; rows: (TodayStageArea & { unit?: string })[] }[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.workName === row.workName) last.rows.push(row)
    else groups.push({ workName: row.workName, rows: [row] })
  }
  const grouped = new Set(rows.map((r) => r.workName)).size > 1

  /*
    RV5-21. Man-hours only exist from 0030, so the two cumulative figures are
    totals over the updates that CARRY hours, not over everything this deck
    has had done. Said on those two rows' (?) rather than left to be
    discovered (CPY-01): a foreman comparing "Tổng Mhr" against a deck that is
    visibly 60% painted would otherwise conclude the figure is broken.
  */
  const sinceNote = `Giờ công chỉ được ghi từ ngày ${EFFORT_SINCE}. Số tổng này là tổng của những lần `
    + 'cập nhật có ghi giờ, không phải toàn bộ công việc đã làm trên sàn.'
  const hourRows: [string, number, string | undefined][] = [
    ['Mhr thực hiện hôm nay', totals.todayHours, undefined],
    ['Mhr hao phí hôm nay', totals.todayWasteHours, undefined],
    ['Tổng Mhr đã thực hiện đến hôm nay', totals.totalHours, sinceNote],
    ['Tổng Mhr hao phí đến hôm nay', totals.totalWasteHours, sinceNote],
  ]

  /** A figure as printed, or an em dash where the day could not be read. */
  const figure = (text: string) => (status === 'unknown' ? '—' : text)

  return (
    <div data-testid="gs-deck-today">
      <SectionCard
        title="Thông tin nhanh — Hôm nay"
        extra={<span style={{ ...fieldType.caption, color: palette.textTertiary }}>{asVNDate(todayKey)}</span>}
      >
        {status === 'loading' ? (
          <CardSkeleton label="Đang tải thông tin hôm nay" />
        ) : rows.length === 0 ? (
          <div style={{ ...fieldType.body, color: palette.textTertiary }}>{emptyText}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
            {groups.map((group) => (
              <div
                key={group.workName}
                style={{ display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 }}
              >
                {grouped && (
                  <div style={{ ...fieldType.label, color: palette.textSecondary }}>
                    {group.workName}
                  </div>
                )}
                {group.rows.map((row) => (
                  <div
                    key={`${row.workName}/${row.stageName}`}
                    style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, minWidth: 0 }}
                  >
                    <span
                      style={{
                        ...fieldType.body,
                        color: palette.textSecondary,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.stageName}
                    </span>
                    <span style={{ ...fieldType.bodyStrong, marginLeft: 'auto', flex: 'none' }}>
                      {figure(`${formatAreaM2(row.areaM2)} ${row.unit ?? DEFAULT_UNIT}`)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {status !== 'loading' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: space.sm,
              marginTop: space.lg,
              paddingTop: space.lg,
              borderTop: `1px solid ${palette.borderSplit}`,
            }}
          >
            {hourRows.map(([label, value, tip]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, minWidth: 0 }}>
                <span style={{ ...fieldType.body, color: palette.textTertiary, minWidth: 0 }}>
                  {label}
                  {tip !== undefined && <InfoTip text={tip} />}
                </span>
                <span style={{ ...fieldType.bodyStrong, marginLeft: 'auto', flex: 'none' }}>
                  {figure(formatHours(value))}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
