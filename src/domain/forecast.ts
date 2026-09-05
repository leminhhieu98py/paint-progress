import type { StageEfficiency } from './effort'
import type { Stage, StageProgress } from './types'

/**
 * How much work is left on a deck and whether its deadline is reachable
 * (Feedback Rv2, item 13), computed exactly as Linh's workbook computes it
 * ("Cách tính số Mhr và ngày còn lại.xlsx", answered 2026-09-05).
 *
 * Per coat: the area still to cover times the measured Mhr/m², divided by the
 * measured Mhr the crew puts in on an average day, rounded UP to whole days.
 *
 * Per deck: the Mhr add up, and the DAYS take the MAX rather than the sum --
 * Linh: "Tính ngày Max vì làm song song". The coats run on different parts of
 * the deck at the same time, so the deck is finished when its slowest coat is,
 * not after every coat has had the deck to itself in turn.
 *
 * Days are calendar days including Sundays ("Làm full ngày chủ nhật"), and
 * wasted hours never enter any of it: "Toàn bộ tính toán dựa trên Mhr thực
 * hiện công việc."
 */

/** One coat's share of what is left. */
export interface StageForecast {
  stageId: string
  stageName: string
  seq: number
  /** Deck area minus the area that has already reached this coat. */
  remainingAreaM2: number
  /** Mean of the daily ratios, from domain/effort.ts. Null: never measured. */
  avgMhrPerM2: number | null
  avgHoursPerDay: number | null
  /** remainingAreaM2 × avgMhrPerM2. Null when the coat has no measurement. */
  mhrNeeded: number | null
  /** ceil(mhrNeeded / avgHoursPerDay). Null when the coat has no measurement. */
  daysNeeded: number | null
}

export interface DeckForecast {
  stages: StageForecast[]
  /** Σ mhrNeeded over the coats that have a measurement. Null when none has. */
  totalMhrNeeded: number | null
  /** MAX daysNeeded over the coats that have a measurement. Null when none has. */
  daysNeeded: number | null
  /** Coats the totals above do NOT cover, because nobody has recorded hours on them. */
  stagesWithoutData: number
  deadline: string | null
  /** Calendar days from today to the deadline, both ends counted; ≤ 0 once past. */
  daysRemaining: number | null
  /** daysNeeded − daysRemaining, only when positive. */
  lateDays: number | null
  /** Σ max(0, mhrNeeded − daysRemaining × avgHoursPerDay) over the coats. */
  shortfallMhr: number | null
}

/**
 * Whole calendar days from `today` to `deadline`, counting both ends: a
 * deadline of today leaves one day to work in, not none. Sundays count like
 * any other day. Zero or negative once the deadline is behind us.
 *
 * Both are 'YYYY-MM-DD'. Parsed as UTC midnights and subtracted, so no local
 * timezone and no daylight rule can shift a boundary -- the caller has already
 * decided which day "today" is in Vietnam (see effortDayKey).
 */
export function daysUntil(today: string, deadline: string): number {
  const day = 24 * 60 * 60 * 1000
  const from = Date.parse(`${today}T00:00:00Z`)
  const to = Date.parse(`${deadline}T00:00:00Z`)
  return Math.round((to - from) / day) + 1
}

export function deckForecast(input: {
  totalAreaM2: number
  stages: Stage[]
  /** Cumulative area per coat, from computeDeckProgress. */
  stageProgress: StageProgress[]
  /** This work's measured efficiency per coat, from stageEfficiency. */
  efficiency: StageEfficiency[]
  deadline: string | null
  /** 'YYYY-MM-DD' in Vietnam time, from effortDayKey. */
  today: string
}): DeckForecast {
  const stages: StageForecast[] = [...input.stages]
    .sort((a, b) => a.seq - b.seq)
    .map((stage) => {
      const done = input.stageProgress.find((sp) => sp.stage.id === stage.id)?.cumulativeAreaM2 ?? 0
      // Never negative: a deck whose declared area is smaller than the area of
      // its bays would otherwise report a coat with -40 m² still to do.
      const remainingAreaM2 = Math.max(0, input.totalAreaM2 - done)
      // Matched on NAME, because that is what the events carry: a coat renamed
      // since the hours were recorded has no history under its new name, and
      // reads as "not measured yet" rather than borrowing another coat's rate.
      const measured = input.efficiency.find((e) => e.stageName === stage.name)
      const avgMhrPerM2 = measured?.avgMhrPerM2 ?? null
      const avgHoursPerDay = measured?.avgHoursPerDay ?? null
      const mhrNeeded = avgMhrPerM2 === null ? null : remainingAreaM2 * avgMhrPerM2
      const daysNeeded = mhrNeeded === null || !avgHoursPerDay
        ? null
        : Math.ceil(mhrNeeded / avgHoursPerDay)
      return {
        stageId: stage.id,
        stageName: stage.name,
        seq: stage.seq,
        remainingAreaM2,
        avgMhrPerM2,
        avgHoursPerDay,
        mhrNeeded,
        daysNeeded,
      }
    })

  const measured = stages.filter((s) => s.mhrNeeded !== null)
  const totalMhrNeeded = measured.length === 0
    ? null
    : measured.reduce((sum, s) => sum + (s.mhrNeeded ?? 0), 0)
  const withDays = stages.filter((s) => s.daysNeeded !== null)
  const daysNeeded = withDays.length === 0
    ? null
    : Math.max(...withDays.map((s) => s.daysNeeded as number))

  const daysRemaining = input.deadline === null ? null : daysUntil(input.today, input.deadline)
  let lateDays: number | null = null
  let shortfallMhr: number | null = null
  if (daysRemaining !== null && daysNeeded !== null) {
    const late = daysNeeded - daysRemaining
    if (late > 0) {
      lateDays = late
      // What each coat cannot get through in the days that are left, added up.
      // A coat that fits contributes nothing: its spare capacity cannot be
      // lent to another coat, since they are worked in parallel by different
      // crews. Days already lost count as zero capacity, not negative.
      const capacityDays = Math.max(0, daysRemaining)
      shortfallMhr = stages.reduce((sum, s) => {
        if (s.mhrNeeded === null || s.avgHoursPerDay === null) return sum
        return sum + Math.max(0, s.mhrNeeded - capacityDays * s.avgHoursPerDay)
      }, 0)
    }
  }

  return {
    stages,
    totalMhrNeeded,
    daysNeeded,
    stagesWithoutData: stages.length - measured.length,
    deadline: input.deadline,
    daysRemaining,
    lateDays,
    shortfallMhr,
  }
}
