import { describe, expect, it } from 'vitest'
import { builder } from './supabaseBuilder'

describe('builder', () => {
  it('resolves the rows of a read', async () => {
    expect((await builder({ data: [1], count: 1 }).select('id')).data).toEqual([1])
  })

  it.each(['insert', 'upsert', 'update', 'delete'] as const)('resolves data: null for a %s without .select(), like return=minimal', async (m) => {
    expect((await builder({ data: [{ id: 'a' }] })[m]({})).data).toBeNull()
  })

  it('resolves the rows of a write that chains .select()', async () => {
    const b = builder({ data: [{ id: 'a' }] })
    b.update({})
    b.eq('id', 'a')
    expect((await b.select('id')).data).toEqual([{ id: 'a' }])
  })
})
