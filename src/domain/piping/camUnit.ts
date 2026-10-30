import { builtInCount, UNIT_LABEL, type UnitCount } from './cam'
import { parseDecimalText } from './imports'
import type { BuiltInUnit, SpoolColumn, Unit } from './types'

/**
 * The Insulation unit selector's choices (spec §6.4, RV9-1): the six
 * built-ins, then every extra spool column -- a text column counted by its
 * distinct values as LineNo is, a number column summed.
 *
 * Its own module rather than in cam.ts: a number column reads its values with
 * the import's strict number rules (`parseDecimalText`), and imports.ts
 * already imports cam.ts, so the resolver sits beside both instead of
 * closing a cycle.
 */

const BUILT_INS = Object.keys(UNIT_LABEL) as BuiltInUnit[]

/** The unit of an extra column, keyed by its id so a renamed column keeps the choice. */
export const columnUnit = (column: Pick<SpoolColumn, 'id'>): Unit => `col:${column.id}`

/** A unit as the screen counts it: the unit in force, its label, and how it counts. */
export interface ResolvedUnit {
  /** The unit asked for; SpoolNo when it named a column no longer configured. */
  unit: Unit
  label: string
  count: UnitCount
}

/**
 * A number column's value on a spool: stored as a plain decimal (`1234.5`),
 * a vi `1.234,5` read too; blank or not a number counts 0 (RV9-1).
 */
function columnNumber(text: string | undefined): number {
  return parseDecimalText(text ?? '') ?? 0
}

/** How `unit` counts over the project's extra `columns`; a deleted column falls back to SpoolNo. */
export function resolveUnit(unit: Unit, columns: readonly SpoolColumn[]): ResolvedUnit {
  if (!unit.startsWith('col:')) {
    const builtIn = unit as BuiltInUnit
    return { unit: builtIn, label: UNIT_LABEL[builtIn], count: builtInCount(builtIn) }
  }
  const column = columns.find((c) => columnUnit(c) === unit)
  if (column === undefined) return resolveUnit('spoolNo', columns)
  const { label } = column
  return {
    unit,
    label,
    count: column.kind === 'number'
      ? { kind: 'sum', value: (s) => columnNumber(s.extra[label]) }
      : { kind: 'distinct', value: (s) => s.extra[label] ?? null },
  }
}

/** The unit's label, as the selector shows it. */
export function unitLabel(unit: Unit, columns: readonly SpoolColumn[]): string {
  return resolveUnit(unit, columns).label
}

/** The selector's options: the built-ins, then the extra columns in their configured order. */
export function unitOptions(columns: readonly SpoolColumn[]): Array<{ value: Unit; label: string }> {
  return [
    ...BUILT_INS.map((u) => ({ value: u as Unit, label: UNIT_LABEL[u] })),
    ...[...columns].sort((a, b) => a.sort - b.sort).map((c) => ({ value: columnUnit(c), label: c.label })),
  ]
}
