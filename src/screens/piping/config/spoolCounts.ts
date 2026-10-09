import type { Spool } from '../../../domain/piping/types'

const keyOf = (label: string) => label.trim().toLowerCase()

/**
 * The spools a column rename rewrites, matched as piping_rename_spool_column
 * (0039) matches them: a key equal to the old label, or any key equal to the
 * new label ignoring case and outer spaces (those values are dropped).
 */
export function spoolsRenamed(spools: readonly Spool[], oldLabel: string, newLabel: string): number {
  const newKey = keyOf(newLabel)
  return spools.filter((s) => Object.keys(s.extra).some((k) => k === oldLabel || keyOf(k) === newKey)).length
}

/** The spools a column delete strips, matched as piping_delete_spool_column (0039) does. */
export function spoolsWithColumn(spools: readonly Spool[], label: string): number {
  const key = keyOf(label)
  return spools.filter((s) => Object.keys(s.extra).some((k) => keyOf(k) === key)).length
}
