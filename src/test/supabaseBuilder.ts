import { vi } from 'vitest'

/** The builder methods the API modules chain. */
const METHODS = [
  'select', 'insert', 'upsert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'not',
  'contains', 'containedBy', 'order', 'limit', 'range', 'single', 'maybeSingle',
] as const

export type MockBuilder = Record<(typeof METHODS)[number], ReturnType<typeof vi.fn>>
  & PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>

/**
 * The PostgREST builder shape, as the kpiApi tests model it: every method
 * chains and records its arguments, awaiting resolves to `{ data, error }`
 * (postgrest-js reports failure as a value, never a throw).
 */
export function builder(result: { data?: unknown; error?: unknown } = {}): MockBuilder {
  const b: Record<string, unknown> = {}
  for (const m of METHODS) b[m] = vi.fn(() => b)
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject)
  return b as unknown as MockBuilder
}
