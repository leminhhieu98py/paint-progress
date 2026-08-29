import { Donut } from '../../components/Donut'
import { ProgressBar } from '../../components/ProgressBar'
import { stageSeqOf } from '../../domain/progress'
import type { Cell, Stage, StageProgress } from '../../domain/types'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { palette, shadowCard } from '../../theme'

const cardStyle = {
  background: palette.bgContainer,
  border: `1px solid ${palette.borderCard}`,
  borderRadius: 14,
  boxShadow: shadowCard,
  padding: '18px 20px 20px',
} as const

/**
 * The one number the foreman is asked for on the radio.
 *
 * Its own card, in the largest type on the screen. It used to be the middle of
 * the ring, which put it inside a chart the foreman has to interpret before
 * reading it -- and left it competing with five stage figures for the eye.
 */
export function DeckProgressCard({
  progress,
  totalAreaM2,
}: {
  progress: number
  totalAreaM2: number
}) {
  return (
    <div data-testid="gs-deck-progress" style={cardStyle}>
      <div style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>Tiến độ sàn</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
        <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.032em' }}>
          {formatPercent(progress)}
        </span>
      </div>
      <div style={{ marginTop: 14 }}>
        {/* No label of its own: the figure is already above it, in the
            largest type on the screen. */}
        <ProgressBar ratio={progress} color={palette.accent} height={8} showLabel={false} />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginTop: 14,
          fontSize: 13,
        }}
      >
        <span style={{ color: palette.textTertiary }}>Diện tích sàn</span>
        <span style={{ marginLeft: 'auto', fontWeight: 600 }}>
          {`${formatAreaM2(totalAreaM2)} m²`}
        </span>
      </div>
    </div>
  )
}

/**
 * How far each coat has got across the deck, cumulatively.
 *
 * Two figures per row, because the foreman and the office read different ones.
 * The bay count is what he can check against the drawing in front of him --
 * "158 of 184" is countable. The percentage is the one that leaves this screen:
 * it is area-weighted, the same figure the report bills against, so it is
 * deliberately NOT the bay fraction rounded. On a deck whose bays differ in
 * size the two do not agree, and the area one is the true one.
 *
 * The ring beside them is the non-cumulative view: which coat each bay is
 * sitting at right now. Cumulative bars and a non-cumulative ring answer
 * different questions, and both are asked.
 */
export function StageRollupCard({
  stages,
  stageProgress,
  cells,
}: {
  stages: Stage[]
  stageProgress: StageProgress[]
  cells: Cell[]
}) {
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)
  const total = cells.length

  const ringSlices = ordered
    .map((stage) => ({
      label: stage.name,
      color: stage.color,
      value: total > 0 ? cells.filter((c) => c.stageId === stage.id).length / total : 0,
    }))
    .filter((s) => s.value > 0)

  return (
    <div data-testid="gs-stage-rollup" style={cardStyle}>
      <div style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary, marginBottom: 14 }}>
        Tiến độ theo công đoạn · cộng dồn
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        {/*
          The bay count in the middle, not the deck percentage.

          The design puts the percentage there, and it is already the largest
          thing on the screen one card above. Two copies of one number is not
          emphasis -- it is two things to keep in step, and one of them will
          eventually be the stale one. The count is what the ring is actually
          dividing up, and it is the number the foreman checks his own tally
          against.
        */}
        <Donut slices={ringSlices} size={132} thickness={24}>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.028em' }}>{total}</span>
          <span style={{ fontSize: 10, color: palette.textTertiary, marginTop: 2 }}>
            ô trên sàn
          </span>
        </Donut>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, flex: 1, minWidth: 168 }}>
          {ordered.map((stage, i) => {
            const reached = cells.filter(
              (c) => stageSeqOf(stages, c.stageId) >= stage.seq,
            ).length
            const ratio = stageProgress.find((sp) => sp.stage.id === stage.id)?.ratio ?? 0
            return (
              <div
                key={stage.id}
                style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 26,
                    height: 26,
                    flex: 'none',
                    borderRadius: '50%',
                    background: palette.bgContainer,
                    boxShadow: `inset 0 0 0 3px ${stage.color}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    color: palette.textSecondary,
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                    {stage.name}
                  </div>
                  <div style={{ fontSize: 12, color: palette.textTertiary, marginTop: 2 }}>
                    {`${reached}/${total} ô · ${formatPercent(ratio)}`}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
