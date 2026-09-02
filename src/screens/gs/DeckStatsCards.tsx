import { Donut } from '../../components/Donut'
import { ProgressBar } from '../../components/ProgressBar'
import { buildStageSlices, NOT_STARTED_KEY, UNMAPPED_KEY } from '../../domain/pieSlices'
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
 * Each row reads "m² done / deck m² · percent", and all three come from the
 * same place: `cumulativeAreaM2` over `totalAreaM2` IS the ratio, so the row
 * cannot disagree with itself. It used to lead with a bay count -- "158 of
 * 184" -- which the client's review struck: bays differ in size, so a count
 * says nothing the office can bill from, and the percentage stood beside a
 * fraction it visibly did not match.
 *
 * The ring beside them is the non-cumulative view: how much AREA is sitting at
 * each coat right now, from the same slice builder the admin's ring uses.
 * Cumulative rows and a non-cumulative ring answer different questions, and
 * both are asked.
 */
export function StageRollupCard({
  stages,
  stageProgress,
  cells,
  totalAreaM2,
}: {
  stages: Stage[]
  stageProgress: StageProgress[]
  cells: Cell[]
  totalAreaM2: number
}) {
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)

  // Coats only. The not-started and unmapped slices keep the admin's pie on
  // the deck's denominator; here the ring's own remainder plays that part.
  const ringSlices = buildStageSlices(totalAreaM2, cells, stages)
    .filter((s) => s.key !== NOT_STARTED_KEY && s.key !== UNMAPPED_KEY)
    .map((s) => ({
      label: s.label,
      color: s.color,
      value: totalAreaM2 > 0 ? s.areaM2 / totalAreaM2 : 0,
    }))
    .filter((s) => s.value > 0)

  return (
    <div data-testid="gs-stage-rollup" style={cardStyle}>
      <div style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary, marginBottom: 14 }}>
        Tiến độ theo công đoạn · cộng dồn
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        {/*
          The deck area in the middle, not the deck percentage.

          The design puts the percentage there, and it is already the largest
          thing on the screen one card above. Two copies of one number is not
          emphasis -- it is two things to keep in step, and one of them will
          eventually be the stale one. The area is what the ring is actually
          dividing up.
        */}
        <Donut slices={ringSlices} size={132} thickness={24}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.028em' }}>
            {formatAreaM2(totalAreaM2)}
          </span>
          <span style={{ fontSize: 10, color: palette.textTertiary, marginTop: 2 }}>
            m² sàn
          </span>
        </Donut>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, flex: 1, minWidth: 168 }}>
          {ordered.map((stage, i) => {
            const sp = stageProgress.find((x) => x.stage.id === stage.id)
            const doneM2 = sp?.cumulativeAreaM2 ?? 0
            const ratio = sp?.ratio ?? 0
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
                    {`${formatAreaM2(doneM2)} / ${formatAreaM2(totalAreaM2)} m² · ${formatPercent(ratio)}`}
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
