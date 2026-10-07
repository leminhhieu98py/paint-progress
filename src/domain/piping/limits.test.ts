import { describe, expect, it } from 'vitest'
import * as imports from './imports'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from './limits'

describe('piping import limits (spec §8)', () => {
  it('holds 20 000 rows and 5 MB, the values the import module still exports', () => {
    expect(MAX_IMPORT_ROWS).toBe(20_000)
    expect(MAX_IMPORT_BYTES).toBe(5 * 1024 * 1024)
    expect(imports.MAX_IMPORT_ROWS).toBe(MAX_IMPORT_ROWS)
    expect(imports.MAX_IMPORT_BYTES).toBe(MAX_IMPORT_BYTES)
  })
})
