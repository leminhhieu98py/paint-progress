import type { ReactNode } from 'react'
import { palette, space } from '../theme'
import { InfoTip } from './InfoTip'
import { useTypeScale } from './typeScale'

/**
 * One fact beside a title (HLT-01): a `value` in bodyStrong, with the caption
 * words that name it -- `label` after it ("2 công việc"), or `prefix` before
 * it ("tổng 1,00") where the sentence reads that way.
 *
 * `warning` is for a data-quality fact (some updates carry no hours); its
 * explanation goes in `info`, a `(?)` inside the pill, never a trailing
 * sentence.
 */
export interface KeyFact {
  value?: ReactNode
  label?: ReactNode
  prefix?: ReactNode
  tone?: 'neutral' | 'warning'
  info?: string
}

const TONES = {
  neutral: { background: palette.bgSubtle, color: palette.textSecondary, borderColor: palette.borderCard },
  warning: { background: palette.warningBg, color: palette.warning, borderColor: palette.warningBorder },
} as const

/**
 * The one way this app shows the facts beside a card or page title (HLT-01):
 * a row of small pills, right after the title on its line, wrapping below it
 * when the line is narrow. A fact that is not there (`false`, `null`) is left
 * out, so a caller lists its facts conditionally without filtering.
 */
export function KeyFacts({ facts }: { facts: ReadonlyArray<KeyFact | false | null | undefined> }) {
  const t = useTypeScale()
  const shown = facts.filter((f): f is KeyFact => Boolean(f))
  if (shown.length === 0) return null
  return (
    <span
      data-testid="key-facts"
      style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, minWidth: 0 }}
    >
      {shown.map((f, i) => {
        const tone = TONES[f.tone ?? 'neutral']
        return (
          <span
            // Facts are positional and never reorder within one render.
            key={i}
            data-testid="key-fact"
            style={{
              // inline-block, not flex: the spaces between value and label
              // are real text, so they render and read as one phrase.
              display: 'inline-block',
              padding: `2px ${space.sm}px`,
              borderRadius: 999,
              border: `1px solid ${tone.borderColor}`,
              background: tone.background,
              color: tone.color,
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
            }}
          >
            {f.prefix !== undefined && <span style={t.caption}>{f.prefix}</span>}
            {f.prefix !== undefined && f.value !== undefined && ' '}
            {f.value !== undefined && <span style={t.bodyStrong}>{f.value}</span>}
            {f.label !== undefined && (f.value !== undefined || f.prefix !== undefined) && ' '}
            {f.label !== undefined && <span style={t.caption}>{f.label}</span>}
            {f.info !== undefined && <InfoTip text={f.info} />}
          </span>
        )
      })}
    </span>
  )
}
