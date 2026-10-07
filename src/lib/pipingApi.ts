/**
 * The Piping API (spec 2026-10-07-piping §2-§9, migration 0038), one entry
 * point split by area under `pipingApi/`. Every read maps PostgREST rows into
 * the camelCase domain types of `domain/piping/types.ts`; every write goes
 * through a definer function of 0038 or, for the admin's direct edits, the
 * table with its RLS and triggers.
 */
export {
  NO_PERMISSION, NOT_SAVED, PIPING_PAGE, TOO_MANY_ROWS, type PipingImportResult,
} from './pipingApi/shared'
export * from './pipingApi/settings'
export * from './pipingApi/reinstatement'
export * from './pipingApi/manpower'
export * from './pipingApi/spools'
export * from './pipingApi/spoolColumns'
export * from './pipingApi/notes'
