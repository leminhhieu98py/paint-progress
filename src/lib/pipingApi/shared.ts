import { MAX_IMPORT_ROWS } from '../../domain/piping/imports'
import { supabase } from '../supabase'

/**
 * What every Piping API module shares (spec 2026-10-07-piping §2-§9, the
 * contract of migration 0038): the error mapping, the pager, the RPC call and
 * the small number/stamp mappers.
 */

/** The shape postgrest-js reports a failure in -- as a value, never a throw. */
export interface DbError {
  message: string
  code?: string
}

/** The one message for a write the database refused for want of a right. */
export const NO_PERMISSION = 'Bạn không có quyền thực hiện thao tác này'

/**
 * A write that matched no row. RLS hides a row from an UPDATE or DELETE
 * rather than erroring, so a refused write and a row deleted meanwhile look
 * the same: zero rows, no error.
 */
export const NOT_SAVED = 'Không lưu được: dữ liệu này không còn tồn tại, hoặc bạn không có quyền sửa.'

/** The functions' own size message, used for the same limit client-side. */
export const TOO_MANY_ROWS = 'File vượt quá 20 000 dòng'

/** Rows per file and spools per project (0038: every replace caps at this). */
export const MAX_ROWS = MAX_IMPORT_ROWS

/** PostgREST answers at most 1000 rows per request, silently (db-max-rows). */
export const PIPING_PAGE = 1000

/**
 * A database error as the Error a screen shows.
 *
 * The functions of 0038 raise their rule violations (P0001) and their own
 * refusals (42501) in Vietnamese, meant to be shown as is -- those pass
 * through untouched. What Postgres itself says in English is translated: the
 * RLS refusal of a direct write ("new row violates row-level security
 * policy ...") and a revoked grant ("permission denied for table ..."), both
 * 42501; and, when the caller names it, a unique violation (23505).
 */
export function toError(error: DbError, uniqueMessage?: string): Error {
  if (error.code === '42501' && /row-level security|permission denied/i.test(error.message)) {
    return new Error(NO_PERMISSION)
  }
  if (error.code === '23505' && uniqueMessage) return new Error(uniqueMessage)
  return new Error(error.message)
}

/** `numeric` arrives from PostgREST as a STRING; null stays null; '0' stays 0. */
export const numberOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** A `numeric not null` column. */
export const toNumber = (v: unknown): number => Number(v)

/** The `full_name` of an embedded profile, or null when RLS hides it or the actor is gone. */
export function nameOf(embed: unknown): string | null {
  const row = Array.isArray(embed) ? embed[0] : embed
  return (row as { full_name?: string } | null | undefined)?.full_name ?? null
}

/** A calendar day as the database takes it. */
export function isDayKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

type PageResult = PromiseLike<{ data: unknown[] | null; error: DbError | null }>

/**
 * Every row of a read, page by page, until a short page comes back (as
 * `progressApi.listCellStates`). `page(from, to)` must order by a total key --
 * the primary key or a unique tiebreak -- or two pages could overlap or skip.
 * A small table costs exactly the one request an unpaged read would.
 */
export async function readAll<T>(page: (from: number, to: number) => PageResult): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PIPING_PAGE) {
    const { data, error } = await page(from, from + PIPING_PAGE - 1)
    if (error) throw toError(error)
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < PIPING_PAGE) break
  }
  return rows
}

/** One RPC of 0038/0039; its error mapped as above. */
export async function callRpc<T>(name: string, args: Record<string, unknown>, uniqueMessage?: string): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw toError(error, uniqueMessage)
  return data as T
}

/** A direct write that must have touched a row (see NOT_SAVED). */
export function requireRows(data: unknown[] | null, message: string = NOT_SAVED): void {
  if (!data || data.length === 0) throw new Error(message)
}

/** What a confirmed plan import returns: the log row and the summary it wrote. */
export interface PipingImportResult {
  logId: string
  /** The caller's summary merged with the counts the function computed. */
  summary: Record<string, unknown>
}

/** The replace functions return their summary plus "log_id". */
export function importResult(data: unknown): PipingImportResult {
  const { log_id: logId, ...summary } = (data ?? {}) as Record<string, unknown>
  return { logId: String(logId ?? ''), summary }
}

/** Trimmed, refused when blank. */
export function requiredText(value: string, message: string): string {
  const text = (value ?? '').trim()
  if (text === '') throw new Error(message)
  return text
}
