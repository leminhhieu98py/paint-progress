import { useEffect, useSyncExternalStore } from 'react'
import type { PipingSettings } from '../../domain/piping/types'
// The settings read alone, not the barrel nor the writers: the field header is
// in every field page's chunk, and the rest of the Piping API has no business there.
import { getPipingSettings } from '../../lib/pipingApi/settingsRead'
import { onSessionEnd } from '../../lib/sessionCache'

/**
 * Whether each project has Piping on (spec §2, R-1), kept for the session so
 * the field header knows at once on the next page and never flashes a tab it
 * then takes away. Every field page still reads it again on mount: the admin
 * may have turned Piping on or off since.
 *
 * The Piping page reads its settings through `readPipingSettings` too, so the
 * page and the header share one request and one answer.
 */
const enabled = new Map<string, boolean>()
const inFlight = new Map<string, Promise<PipingSettings | null>>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

// One account's answers are not the next account's (RR-M5).
onSessionEnd(() => {
  enabled.clear()
  inFlight.clear()
  notify()
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Records what a read answered, for the header. */
export function rememberPipingEnabled(projectId: string, on: boolean): void {
  if (enabled.get(projectId) === on) return
  enabled.set(projectId, on)
  notify()
}

/** What this session already knows of the project's Piping, or undefined when it has not read it yet. */
export function knownPipingEnabled(projectId: string): boolean | undefined {
  return enabled.get(projectId)
}

/** The project's settings (null: never enabled), one request at a time per project, remembered for the header. */
export function readPipingSettings(projectId: string): Promise<PipingSettings | null> {
  const pending = inFlight.get(projectId)
  if (pending) return pending
  const request = getPipingSettings(projectId)
    .then((settings) => {
      rememberPipingEnabled(projectId, settings?.enabled === true)
      return settings
    })
    .finally(() => {
      if (inFlight.get(projectId) === request) inFlight.delete(projectId)
    })
  inFlight.set(projectId, request)
  return request
}

/**
 * True once the project is known to have Piping on. False while unknown and
 * after a failed read: the tab appears when the answer does, never the other
 * way round.
 */
export function usePipingEnabled(projectId: string): boolean {
  const on = useSyncExternalStore(subscribe, () => enabled.get(projectId) === true, () => false)
  useEffect(() => {
    readPipingSettings(projectId).catch(() => {})
  }, [projectId])
  return on
}
