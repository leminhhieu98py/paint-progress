import { Skeleton } from 'antd'
import { useState, type CSSProperties } from 'react'
import { Donut } from '../../components/Donut'
import { InfoTip } from '../../components/InfoTip'
import { legendRowProps } from '../../components/ringHover'
import { ProgressBar } from '../../components/ProgressBar'
import { SectionCard } from '../../components/SectionCard'
import { GS_RING, GS_RING_SIZE, GS_RING_THICKNESS, ringFigureStep } from '../../components/ringFit'
import { buildStageSlices, NOT_STARTED_KEY, UNMAPPED_KEY } from '../../domain/pieSlices'
import type { Cell, Stage, StageProgress } from '../../domain/types'
import { DEFAULT_QUANTITY_LABEL, DEFAULT_UNIT } from '../../domain/unit'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { fieldType, palette, space } from '../../theme'

/** The coat legend's colour dot, the admin legends' size (CLR-03). */
const MARKER = 11
/**
 * A coat row's first line: the name's line height, which the percent shares,
 * so a wrapped name keeps its dot and its percent on its first line (RR2-M1).
 */
const COAT_LINE = fieldType.body.fontSize * 1.25

const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/**
 * What a stats card knows about its deck. `loading` while the deck's reads are
 * in flight, `unknown` when they have settled without an answer; a card never
 * prints a figure in either, because a 0,00% there reads as data.
 */
export type DeckFigureStatus = 'ready' | 'loading' | 'unknown'

/** A card's body while its deck loads: a skeleton, announced as loading. */
export function CardSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      <Skeleton active title={false} paragraph={{ rows: 3 }} />
    </div>
  )
}

/**
 * The one number the foreman is asked for on the radio.
 *
 * Its own card, in the largest type on the screen. It used to be the middle of
 * the ring, which put it inside a chart the foreman has to interpret before
 * reading it -- and left it competing with five stage figures for the eye.
 */
export function DeckProgressCard({
  status = 'ready',
  progress,
  totalAreaM2,
  perWork = [],
  quantityLabel = DEFAULT_QUANTITY_LABEL,
  unit = DEFAULT_UNIT,
}: {
  /** See DeckFigureStatus. `progress` and `perWork` are read only when ready. */
  status?: DeckFigureStatus
  /** P_d: the deck across its works, weighted by W·D (0024). */
  progress: number
  totalAreaM2: number
  /** The active work's quantity and unit (RV6-35): `<label> sàn`, `<n> <unit>`. */
  quantityLabel?: string
  unit?: string
  /**
   * P_wd per bays work the deck is in. Shown only when there are several:
   * with one work the deck figure IS the work's, and a row repeating it is a
   * second number to keep in step for nothing.
   */
  perWork?: { id: string; name: string; progress: number }[]
}) {
  const several = status === 'ready' && perWork.length > 1
  return (
    <div data-testid="gs-deck-progress">
      <SectionCard
        title={(
          <>
            Tiến độ sàn
            {/* What the figure aggregates, where the admin's deck page says it (round 4). */}
            {several && <InfoTip text="Tổng hợp các công việc" />}
          </>
        )}
      >
        {status === 'loading' ? (
          // Everything below waits for the deck: the unit and the quantity
          // are the active work's, and the works are part of what is loading.
          <CardSkeleton label="Đang tải tiến độ sàn" />
        ) : (
          <>
            <div style={{ ...fieldType.display, lineHeight: 1, letterSpacing: '-0.032em' }}>
              {status === 'unknown' ? '—' : formatPercent(progress)}
            </div>
            {status === 'ready' && (
              <div style={{ marginTop: space.lg }}>
                {/* No label of its own: the figure is already above it, in the
                    largest type on the screen. */}
                <ProgressBar ratio={progress} color={palette.accent} height={8} showLabel={false} />
              </div>
            )}
          </>
        )}
        {several && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, marginTop: space.lg }}>
            {perWork.map((row) => (
              <div key={row.id} style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, minWidth: 0 }}>
                <span style={{ ...fieldType.body, ...ellipsis, color: palette.textSecondary, minWidth: 0 }}>
                  {row.name}
                </span>
                <span style={{ ...fieldType.bodyStrong, marginLeft: 'auto', flex: 'none' }}>
                  {formatPercent(row.progress)}
                </span>
              </div>
            ))}
          </div>
        )}
        {status !== 'loading' && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, marginTop: space.lg }}>
            <span style={{ ...fieldType.body, color: palette.textTertiary }}>{`${quantityLabel} sàn`}</span>
            <span style={{ ...fieldType.bodyStrong, marginLeft: 'auto' }}>
              {`${formatAreaM2(totalAreaM2)} ${unit}`}
            </span>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

/**
 * How far each coat has got across the deck, cumulatively.
 *
 * Each row reads the coat and its percent, then "m² done / deck m²", and all
 * three come from the same place: `cumulativeAreaM2` over `totalAreaM2` IS
 * the ratio, so the row cannot disagree with itself. It used to lead with a
 * bay count -- "158 of
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
  unit = DEFAULT_UNIT,
}: {
  stages: Stage[]
  stageProgress: StageProgress[]
  cells: Cell[]
  totalAreaM2: number
  /** The active work's unit (RV6-35): the coats here are that work's. */
  unit?: string
}) {
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)
  /** The ring slice and coat row under the pointer or focus (CHT-02). */
  const [active, setActive] = useState<string | null>(null)
  /** A coat row's figures, as the row prints them. */
  const figures = (areaM2: number, ratio: number) =>
    `${formatAreaM2(areaM2)} / ${formatAreaM2(totalAreaM2)} ${unit} · ${formatPercent(ratio)}`

  // Coats only. The not-started and unmapped slices keep the admin's pie on
  // the deck's denominator; here the ring's own remainder plays that part.
  // Each slice says what stands at its coat now and, as its row prints it,
  // how much has been through it -- the row is cumulative, the ring is not.
  const ringSlices = buildStageSlices(totalAreaM2, cells, stages)
    .filter((s) => s.key !== NOT_STARTED_KEY && s.key !== UNMAPPED_KEY)
    .map((s) => {
      const value = totalAreaM2 > 0 ? s.areaM2 / totalAreaM2 : 0
      const sp = stageProgress.find((x) => x.stage.id === s.key)
      return {
        key: s.key,
        label: s.label,
        color: s.color,
        value,
        detail: [
          `Đang ở lớp này: ${figures(s.areaM2, value)}`,
          `Cộng dồn: ${figures(sp?.cumulativeAreaM2 ?? 0, sp?.ratio ?? 0)}`,
        ],
      }
    })
    .filter((s) => s.value > 0)

  const areaText = formatAreaM2(totalAreaM2)
  const areaStep = ringFigureStep(areaText, [fieldType.displaySm, fieldType.cardTitle, fieldType.bodyStrong], GS_RING)

  return (
    <div data-testid="gs-stage-rollup">
      <SectionCard title="Tiến độ theo công đoạn · cộng dồn">
        {/*
          The ring above its legend, the legend the card's full width (RR-I1,
          C4): beside a 144 px ring in a 320-372 px rail the names had about
          90 px and wrapped even when short.
        */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space.lg }}>
          {/*
            The deck area in the middle, not the deck percentage.

            The design puts the percentage there, and it is already the largest
            thing on the screen one card above. Two copies of one number is not
            emphasis -- it is two things to keep in step, and one of them will
            eventually be the stale one. The area is what the ring is actually
            dividing up.
          */}
          <Donut
            label="Diện tích đang dừng ở mỗi lớp"
            slices={ringSlices}
            size={GS_RING_SIZE}
            thickness={GS_RING_THICKNESS}
            activeKey={active}
            onActiveChange={setActive}
          >
            {/* The largest step that fits the hole, down to bodyStrong (I-2). */}
            <span data-testid="ring-figure" style={{ ...areaStep, letterSpacing: '-0.028em' }}>
              {areaText}
            </span>
            <span style={{ ...fieldType.caption, color: palette.textTertiary, marginTop: 2 }}>
              {`${unit} sàn`}
            </span>
          </Donut>
          <div
            data-testid="gs-stage-legend"
            style={{ display: 'flex', flexDirection: 'column', gap: space.md, alignSelf: 'stretch', minWidth: 0 }}
          >
            {ordered.map((stage) => {
              const sp = stageProgress.find((x) => x.stage.id === stage.id)
              const doneM2 = sp?.cumulativeAreaM2 ?? 0
              const ratio = sp?.ratio ?? 0
              return (
                <div
                  key={stage.id}
                  data-testid="gs-stage-row"
                  {...legendRowProps(stage.id, active, setActive, {
                    display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
                  })}
                >
                  {/*
                    Two lines: the dot, the name and its percent, then the area.
                    The figures never wrap; a name wraps only when the whole
                    width cannot hold it, and its title holds all of it.
                  */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: space.sm, minWidth: 0 }}>
                    {/* The coat's colour as a plain circle, as every legend in the app (CLR-03). */}
                    <span
                      aria-hidden
                      data-testid="gs-stage-marker"
                      style={{
                        width: MARKER, height: MARKER, flex: 'none', borderRadius: '50%', background: stage.color,
                        marginTop: (COAT_LINE - MARKER) / 2,
                      }}
                    />
                    <span
                      title={stage.name}
                      style={{ ...fieldType.body, minWidth: 0, flex: 1, lineHeight: `${COAT_LINE}px`, overflowWrap: 'break-word' }}
                    >
                      {stage.name}
                    </span>
                    <span
                      data-testid="gs-stage-percent"
                      style={{ ...fieldType.bodyStrong, lineHeight: `${COAT_LINE}px`, flex: 'none', whiteSpace: 'nowrap' }}
                    >
                      {formatPercent(ratio)}
                    </span>
                  </div>
                  <div
                    data-testid="gs-stage-area"
                    style={{
                      ...fieldType.caption,
                      ...ellipsis,
                      color: palette.textTertiary,
                      paddingInlineStart: MARKER + space.sm,
                    }}
                  >
                    {`${formatAreaM2(doneM2)} / ${formatAreaM2(totalAreaM2)} ${unit}`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
