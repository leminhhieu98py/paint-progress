import type { DeckEffortTotals } from '../../domain/effort'
import type { TodayStageArea } from '../../domain/today'
import { formatAreaM2, formatHours } from '../../lib/format'
import { palette, shadowCard } from '../../theme'

/** DeckStatsCards' chrome, so the rail reads as one stack of cards. */
const cardStyle = {
  background: palette.bgContainer,
  border: `1px solid ${palette.borderCard}`,
  borderRadius: 14,
  boxShadow: shadowCard,
  padding: '18px 20px 20px',
} as const

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
  todayKey,
  rows,
  totals,
}: {
  /** `effortDayKey` of now. Named on the card, so a tablet left open overnight
   *  cannot quietly report yesterday as today. */
  todayKey: string
  /** Every coat of the deck, in seq order, with today's m². See todayAreaByStage. */
  rows: TodayStageArea[]
  /** The four figures of RV5-19, straight from `deckEffortTotals`. */
  totals: DeckEffortTotals
}) {
  /** Preserves `rows`' order; the caller owns seq order. */
  const groups: { workName: string; rows: TodayStageArea[] }[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.workName === row.workName) last.rows.push(row)
    else groups.push({ workName: row.workName, rows: [row] })
  }
  const grouped = new Set(rows.map((r) => r.workName)).size > 1

  const hourRows: [string, number][] = [
    ['Mhr thực hiện hôm nay', totals.todayHours],
    ['Mhr hao phí hôm nay', totals.todayWasteHours],
    ['Tổng Mhr đã thực hiện đến hôm nay', totals.totalHours],
    ['Tổng Mhr hao phí đến hôm nay', totals.totalWasteHours],
  ]

  return (
    <div data-testid="gs-deck-today" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>
          Thông tin nhanh — Hôm nay
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: palette.textQuaternary }}>
          {asVNDate(todayKey)}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: palette.textTertiary }}>
          Sàn này chưa có công đoạn nào. Quản trị viên cần khai báo công đoạn trước khi ghi tiến độ.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {groups.map((group) => (
            <div
              key={group.workName}
              style={{ display: 'flex', flexDirection: 'column', gap: 11, minWidth: 0 }}
            >
              {grouped && (
                <div style={{ fontSize: 12, fontWeight: 600, color: palette.textSecondary }}>
                  {group.workName}
                </div>
              )}
              {group.rows.map((row) => (
                <div
                  key={`${row.workName}/${row.stageName}`}
                  style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: palette.textSecondary,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.stageName}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, flex: 'none' }}>
                    {`${formatAreaM2(row.areaM2)} m²`}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          marginTop: 16,
          paddingTop: 14,
          borderTop: `1px solid ${palette.borderSplit}`,
        }}
      >
        {hourRows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13, color: palette.textTertiary, minWidth: 0 }}>{label}</span>
            <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, flex: 'none' }}>
              {formatHours(value)}
            </span>
          </div>
        ))}
      </div>

      {/*
        RV5-21. Man-hours only exist from 0030, so the two cumulative figures are
        totals over the updates that CARRY hours, not over everything this deck
        has had done. Said on the card rather than left to be discovered: a
        foreman comparing "Tổng Mhr" against a deck that is visibly 60% painted
        would otherwise conclude the figure is broken.
      */}
      <div style={{ fontSize: 11, lineHeight: 1.45, color: palette.textQuaternary, marginTop: 12 }}>
        {`Giờ công chỉ được ghi từ ngày ${EFFORT_SINCE}. Hai số tổng ở trên là tổng của những lần `
        + 'cập nhật có ghi giờ, không phải toàn bộ công việc đã làm trên sàn.'}
      </div>
    </div>
  )
}
