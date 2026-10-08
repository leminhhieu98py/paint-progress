import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Unit } from '../../domain/piping/types'

/**
 * The Insulation unit select's choice (spec §6.4), per project, held by the
 * Piping page so the export writes the report in the unit on screen
 * (spec §10). The Insulation tab reads and sets it with `useInsulationUnit`;
 * the export reads it with `useInsulationUnitValue`.
 *
 * Without a provider above it (a panel rendered alone, as in its own tests)
 * `useInsulationUnit` keeps the choice in the component's own state, as the
 * tab did before the page held it.
 */

export const DEFAULT_UNIT: Unit = 'spoolNo'

interface UnitState {
  units: Record<string, Unit>
  setUnit: (projectId: string, unit: Unit) => void
}

const UnitContext = createContext<UnitState | null>(null)

export function InsulationUnitProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<Record<string, Unit>>({})
  const setUnit = useCallback((projectId: string, unit: Unit) => {
    setUnits((prev) => (prev[projectId] === unit ? prev : { ...prev, [projectId]: unit }))
  }, [])
  const value = useMemo(() => ({ units, setUnit }), [units, setUnit])
  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>
}

/** The Insulation tab's unit and its setter: the page's when it holds one, the caller's own state otherwise. */
export function useInsulationUnit(projectId: string): [Unit, (unit: Unit) => void] {
  const shared = useContext(UnitContext)
  const [own, setOwn] = useState<Unit>(DEFAULT_UNIT)
  const setShared = useCallback((unit: Unit) => shared?.setUnit(projectId, unit), [shared, projectId])
  if (shared === null) return [own, setOwn]
  return [shared.units[projectId] ?? DEFAULT_UNIT, setShared]
}

/** The unit on screen for the project, the default before the tab has changed it. */
export function useInsulationUnitValue(projectId: string | null): Unit {
  const shared = useContext(UnitContext)
  return (projectId !== null ? shared?.units[projectId] : undefined) ?? DEFAULT_UNIT
}
