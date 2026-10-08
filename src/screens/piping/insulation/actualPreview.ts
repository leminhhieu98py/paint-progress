import {
  ACTUAL_FIELD, actualDates, MILESTONE_LABEL, MILESTONES, orderMessage, orderViolations, spoolKey, type ActualChange,
} from '../../../domain/piping/cam'
import { compareText } from '../../../domain/piping/text'
import type { DayKey, Milestone, Spool } from '../../../domain/piping/types'
import { MISSING } from '../../../lib/format'
import type { SpoolActualResult, SpoolActualStatus } from '../../../lib/pipingApi'

/**
 * The actual entry's targets and its preview (spec §6.3). The preview is the
 * database's own judgement -- a dry run of piping_set_spool_actuals -- told in
 * the spools' terms: the stored date each overwrite replaces, why a spool is
 * skipped. The screen never decides on its own what is saved.
 */

/** The milestones of a spool that hold an actual date, PH, IH, IW order: what Xoá Actual can clear (R-12). */
export function setMilestones(spool: Spool): Milestone[] {
  return MILESTONES.filter((m) => spool[ACTUAL_FIELD[m]] !== null)
}

/** What a manual entry applies to: one SpoolNo (every spool carrying it, R-11), a line, a package. */
export type TargetKind = 'spool' | 'line' | 'package'

export const TARGET_LABEL: Record<TargetKind, string> = {
  spool: 'SpoolNo',
  line: 'LineNo',
  package: 'Test Package No',
}

function valueOf(s: Spool, kind: TargetKind): string | null {
  if (kind === 'spool') return spoolKey(s.spoolNo)
  const v = (kind === 'line' ? s.lineNo : s.testPackageNo)?.trim() ?? ''
  return v === '' ? null : v
}

/** The distinct non-blank values of the field, in the module's text order. */
export function targetValues(spools: Spool[], kind: TargetKind): string[] {
  const set = new Set<string>()
  for (const s of spools) {
    const v = valueOf(s, kind)
    if (v !== null) set.add(v)
  }
  return [...set].sort(compareText)
}

/** Every spool carrying the value, in file order. */
export function targetSpools(spools: Spool[], kind: TargetKind, value: string): Spool[] {
  return spools.filter((s) => valueOf(s, kind) === value)
}

export interface ActualOverwriteLine {
  key: string
  spoolId: string
  spoolNo: string
  milestone: Milestone
  from: DayKey
  to: DayKey | null
}

export interface ActualSkipLine {
  key: string
  spoolNo: string
  reason: string
}

export interface ActualPreview {
  /** Spools saved as they are (no stored date replaced). */
  save: number
  /** Spools that replace a stored date: saved only once the user agrees. */
  overwriteSpools: number
  /** Their replaced dates, old -> new. */
  overwrites: ActualOverwriteLine[]
  /** Spools not saved: the order rule (Q18A), or gone since the list was read. */
  skipped: ActualSkipLine[]
  /** Spools already holding these dates. */
  unchanged: number
}

const ORDER_TEXT = `Sai thứ tự ${MILESTONES.map((m) => MILESTONE_LABEL[m]).join(' ≤ ')}`

/** The dry run's statuses (one per spool) against the changes and the spools as read. */
export function actualPreview(spools: Spool[], changes: ActualChange[], results: SpoolActualResult[]): ActualPreview {
  const byId = new Map(spools.map((s) => [s.id, s]))
  const bySpool = new Map<string, ActualChange[]>()
  for (const c of changes) {
    const list = bySpool.get(c.spoolId)
    if (list) list.push(c)
    else bySpool.set(c.spoolId, [c])
  }
  const out: ActualPreview = { save: 0, overwriteSpools: 0, overwrites: [], skipped: [], unchanged: 0 }
  for (const r of results) {
    const spool = byId.get(r.spoolId)
    const spoolNo = spool?.spoolNo ?? r.spoolNo ?? MISSING
    const own = bySpool.get(r.spoolId) ?? []
    if (r.status === 'saved') out.save += 1
    else if (r.status === 'unchanged') out.unchanged += 1
    else if (r.status === 'overwrite_needed') {
      out.overwriteSpools += 1
      if (!spool) continue
      const current = actualDates(spool)
      for (const c of own) {
        const from = current[c.milestone]
        if (from !== null && from !== c.date) {
          out.overwrites.push({ key: `${r.spoolId}|${c.milestone}`, spoolId: r.spoolId, spoolNo, milestone: c.milestone, from, to: c.date })
        }
      }
    } else if (r.status === 'order') {
      let reason = ORDER_TEXT
      if (spool) {
        const next = { ...actualDates(spool) }
        for (const c of own) next[c.milestone] = c.date
        const pairs = orderViolations(next)
        if (pairs.length > 0) reason = orderMessage(next, pairs)
      }
      out.skipped.push({ key: r.spoolId, spoolNo, reason })
    } else {
      out.skipped.push({ key: r.spoolId, spoolNo, reason: 'Không tìm thấy spool' })
    }
  }
  return out
}

/** The changes to send for real: the saved spools, and the overwriting ones once agreed to. */
export function changesToWrite(changes: ActualChange[], results: SpoolActualResult[], overwrite: boolean): ActualChange[] {
  const status = new Map<string, SpoolActualStatus>(results.map((r) => [r.spoolId, r.status]))
  return changes.filter((c) => {
    const s = status.get(c.spoolId)
    return s === 'saved' || (overwrite && s === 'overwrite_needed')
  })
}
