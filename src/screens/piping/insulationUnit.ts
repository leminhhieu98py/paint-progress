import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { CamSelection, Unit } from '../../domain/piping/types'

/**
 * The Insulation tab's chart choices (spec §6.4) -- the unit select and the
 * Plan | Actual | Plan & Actual lines select -- per project, held by the
 * Piping page so the export writes the report as it is on screen (spec §10).
 * The Insulation tab reads and sets them with `useInsulationUnit` and
 * `useInsulationSelection`; the export reads them with the `...Value` hooks.
 *
 * Without a provider above it (a panel rendered alone, as in its own tests)
 * each setter hook keeps the choice in the component's own state, as the tab
 * did before the page held it.
 *
 * Plain TypeScript (no JSX), so the provider and its hooks share a module
 * without breaking Fast Refresh.
 */

export const DEFAULT_UNIT: Unit = 'spoolNo'
export const DEFAULT_SELECTION: CamSelection = 'both'

interface Choices {
  unit: Unit
  selection: CamSelection
}

const DEFAULTS: Choices = { unit: DEFAULT_UNIT, selection: DEFAULT_SELECTION }

interface ChoicesState {
  choices: Record<string, Partial<Choices>>
  setChoice: <K extends keyof Choices>(projectId: string, key: K, value: Choices[K]) => void
}

const ChoicesContext = createContext<ChoicesState | null>(null)

export function InsulationUnitProvider({ children }: { children: ReactNode }) {
  const [choices, setChoices] = useState<Record<string, Partial<Choices>>>({})
  const setChoice = useCallback(<K extends keyof Choices>(projectId: string, key: K, value: Choices[K]) => {
    setChoices((prev) => (prev[projectId]?.[key] === value
      ? prev
      : { ...prev, [projectId]: { ...prev[projectId], [key]: value } }))
  }, [])
  const value = useMemo(() => ({ choices, setChoice }), [choices, setChoice])
  return createElement(ChoicesContext.Provider, { value }, children)
}

/** One choice and its setter: the page's when it holds them, the caller's own state otherwise. */
function useChoice<K extends keyof Choices>(projectId: string, key: K): [Choices[K], (value: Choices[K]) => void] {
  const shared = useContext(ChoicesContext)
  const [own, setOwn] = useState<Choices[K]>(DEFAULTS[key])
  const setShared = useCallback((value: Choices[K]) => shared?.setChoice(projectId, key, value), [shared, projectId, key])
  if (shared === null) return [own, setOwn]
  return [shared.choices[projectId]?.[key] ?? DEFAULTS[key], setShared]
}

/** The choice on screen for the project, the default before the tab has changed it. */
function useChoiceValue<K extends keyof Choices>(projectId: string | null, key: K): Choices[K] {
  const shared = useContext(ChoicesContext)
  return (projectId !== null ? shared?.choices[projectId]?.[key] : undefined) ?? DEFAULTS[key]
}

/** The Insulation tab's unit and its setter. */
export function useInsulationUnit(projectId: string): [Unit, (unit: Unit) => void] {
  return useChoice(projectId, 'unit')
}

/** The unit on screen for the project. */
export function useInsulationUnitValue(projectId: string | null): Unit {
  return useChoiceValue(projectId, 'unit')
}

/** The Insulation tab's Plan | Actual | Plan & Actual lines and their setter. */
export function useInsulationSelection(projectId: string): [CamSelection, (selection: CamSelection) => void] {
  return useChoice(projectId, 'selection')
}

/** The lines on screen for the project. */
export function useInsulationSelectionValue(projectId: string | null): CamSelection {
  return useChoiceValue(projectId, 'selection')
}
