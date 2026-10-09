import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builder } from '../../test/supabaseBuilder'
import {
  NO_PERMISSION, PIPING_PAGE, callRpc, importResult, isDayKey, nameOf, readAll, toError, toNumber,
} from './shared'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
})

describe('toError', () => {
  it("translates RLS's English refusal of a direct write", () => {
    const e = toError({ code: '42501', message: 'new row violates row-level security policy for table "piping_notes"' })
    expect(e.message).toBe(NO_PERMISSION)
  })

  it('translates a revoked grant', () => {
    expect(toError({ code: '42501', message: 'permission denied for table piping_import_log' }).message).toBe(NO_PERMISSION)
  })

  it("keeps the functions' own Vietnamese 42501 refusals as they are", () => {
    const message = 'Bạn không có quyền ghi dữ liệu Piping của dự án này'
    expect(toError({ code: '42501', message }).message).toBe(message)
    expect(toError({ code: '42501', message: 'Chỉ admin được xoá ngày thực tế' }).message).toBe('Chỉ admin được xoá ngày thực tế')
  })

  it('keeps a rule violation (P0001) as is', () => {
    expect(toError({ code: 'P0001', message: 'Vượt tổng Test Pack (đã có 10 / 12)' }).message)
      .toBe('Vượt tổng Test Pack (đã có 10 / 12)')
  })

  it('names a unique or foreign key violation only when the caller gives the words', () => {
    const unique = { code: '23505', message: 'duplicate key value violates unique constraint "x"' }
    expect(toError(unique, { unique: 'Đã có' }).message).toBe('Đã có')
    expect(toError(unique).message).toBe(unique.message)
    expect(toError(unique, { foreignKey: 'Không còn' }).message).toBe(unique.message)
    const fk = { code: '23503', message: 'insert or update on table "piping_notes" violates foreign key constraint' }
    expect(toError(fk, { foreignKey: 'Không còn' }).message).toBe('Không còn')
    expect(toError(fk, { unique: 'Đã có' }).message).toBe(fk.message)
  })
})

describe('mappers', () => {
  it('reads a numeric sent as a JSON number or as a string, zero included', () => {
    expect(toNumber(12.5)).toBe(12.5)
    expect(toNumber('12.50')).toBe(12.5)
    expect(toNumber('0')).toBe(0)
  })

  it('accepts real calendar days only', () => {
    expect(isDayKey('2026-09-07')).toBe(true)
    expect(isDayKey('2028-02-29')).toBe(true)
    expect(isDayKey('0050-01-01')).toBe(true)
    expect(isDayKey('2026-02-29')).toBe(false)
    expect(isDayKey('2026-02-30')).toBe(false)
    expect(isDayKey('2026-13-01')).toBe(false)
    expect(isDayKey('2026-00-10')).toBe(false)
    expect(isDayKey('0000-01-01')).toBe(false)
    expect(isDayKey('07/09/2026')).toBe(false)
    expect(isDayKey('')).toBe(false)
    expect(isDayKey(null)).toBe(false)
  })

  it('reads an embedded profile name, object or array, or null', () => {
    expect(nameOf({ full_name: 'Lan' })).toBe('Lan')
    expect(nameOf([{ full_name: 'Lan' }])).toBe('Lan')
    expect(nameOf(null)).toBeNull()
  })

  it('splits log_id off the summary', () => {
    expect(importResult({ rows: 3, added: 1, log_id: 'l1' })).toEqual({ logId: 'l1', summary: { rows: 3, added: 1 } })
  })
})

describe('readAll', () => {
  it('pages until a short page and asks for consecutive ranges', async () => {
    const full = Array.from({ length: PIPING_PAGE }, (_, i) => i)
    const ranges: Array<[number, number]> = []
    const pages = [full, full, [1, 2]]
    const rows = await readAll<number>((a, b) => {
      ranges.push([a, b])
      return builder({ data: pages[ranges.length - 1] })
    })
    expect(rows).toHaveLength(2 * PIPING_PAGE + 2)
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('makes one request for a small table', async () => {
    const page = vi.fn(() => builder({ data: [1] }))
    expect(await readAll(page)).toEqual([1])
    expect(page).toHaveBeenCalledTimes(1)
  })

  it('throws the mapped error of any page', async () => {
    await expect(readAll(() => builder({ error: { code: '42501', message: 'permission denied for table x' } })))
      .rejects.toThrow(NO_PERMISSION)
  })
})

describe('callRpc', () => {
  it('passes the name and arguments and returns the data', async () => {
    rpc.mockResolvedValue({ data: 'id1', error: null })
    expect(await callRpc('f', { p_project: 'p1' })).toBe('id1')
    expect(rpc).toHaveBeenCalledWith('f', { p_project: 'p1' })
  })

  it("throws the function's message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Piping chưa được bật cho dự án này' } })
    await expect(callRpc('f', {})).rejects.toThrow('Piping chưa được bật cho dự án này')
  })

  it('names a unique violation when given the words', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value' } })
    await expect(callRpc('f', {}, { unique: 'Đã có' })).rejects.toThrow('Đã có')
  })
})
