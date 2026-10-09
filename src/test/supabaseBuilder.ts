import { vi, type Mock } from 'vitest'

/** The builder methods the API modules chain. */
const METHODS = [
  'select', 'insert', 'upsert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'not',
  'contains', 'containedBy', 'order', 'limit', 'range', 'single', 'maybeSingle',
] as const

const WRITES = new Set(['insert', 'upsert', 'update', 'delete'])

type Chain = Mock<(...args: unknown[]) => MockBuilder>

export interface MockBuilder
  extends PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null; count: number | null }> {
  select: Chain
  insert: Chain
  upsert: Chain
  update: Chain
  delete: Chain
  eq: Chain
  neq: Chain
  in: Chain
  is: Chain
  not: Chain
  contains: Chain
  containedBy: Chain
  order: Chain
  limit: Chain
  range: Chain
  single: Chain
  maybeSingle: Chain
}

/**
 * The PostgREST builder shape, as the kpiApi tests model it: every method
 * chains and records its arguments, awaiting resolves to `{ data, error,
 * count }` (postgrest-js reports failure as a value, never a throw).
 *
 * Like PostgREST (return=minimal), a write -- insert, upsert, update, delete
 * -- resolves `data: null` unless `.select()` was chained, so a write that
 * forgets `.select()` and then checks the rows it touched fails here as it
 * would against the real server.
 */
export function builder(result: { data?: unknown; error?: unknown; count?: number | null } = {}): MockBuilder {
  const b: Record<string, unknown> = {}
  let wrote = false
  let selected = false
  for (const m of METHODS) {
    b[m] = vi.fn(() => {
      if (WRITES.has(m)) wrote = true
      if (m === 'select') selected = true
      return b
    })
  }
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({
      data: wrote && !selected ? null : (result.data ?? null),
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(resolve, reject)
  return b as unknown as MockBuilder
}
