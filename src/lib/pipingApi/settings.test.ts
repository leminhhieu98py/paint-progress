import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builder } from '../../test/supabaseBuilder'
import { NO_PERMISSION, NOT_SAVED } from './shared'
import { disablePiping, enablePiping, getPipingSettings, updatePipingSettings } from './settings'

const from = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { from, rpc } }))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
})

const INPUT = { weekStartDate: '2026-09-07', totalTestPacks: 1022, lateThresholdDays: 7 }

describe('getPipingSettings', () => {
  it('maps the row to camelCase', async () => {
    const b = builder({
      data: { project_id: 'p1', enabled: true, week_start_date: '2026-09-07', total_test_packs: 1022, late_threshold_days: 7 },
    })
    from.mockReturnValue(b)
    expect(await getPipingSettings('p1')).toEqual({
      projectId: 'p1', enabled: true, weekStartDate: '2026-09-07', totalTestPacks: 1022, lateThresholdDays: 7,
      chartColors: {},
    })
    expect(from).toHaveBeenCalledWith('piping_settings')
    expect(String(b.select.mock.calls[0][0])).toContain('chart_colors')
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.maybeSingle).toHaveBeenCalled()
  })

  it('keeps only #rrggbb chart colours (RV8-2)', async () => {
    from.mockReturnValue(builder({
      data: {
        project_id: 'p1', enabled: true, week_start_date: '2026-09-07', total_test_packs: 1, late_threshold_days: 7,
        chart_colors: {
          'rein.planBar': '#1677ff', 'rein.actualBar': '#ABCDEF', 'mp.planTotal': 'red', 'mp.planAvg': '#12345',
          'ins.ph.plan': '#1234567', 'ins.ih.plan': 7, 'ins.iw.plan': null,
        },
      },
    }))
    expect((await getPipingSettings('p1'))?.chartColors).toEqual({ 'rein.planBar': '#1677ff', 'rein.actualBar': '#ABCDEF' })
  })

  it.each([null, 'x', ['#1677ff'], 3])('reads chart colours %o as none', async (chartColors) => {
    from.mockReturnValue(builder({
      data: {
        project_id: 'p1', enabled: true, week_start_date: '2026-09-07', total_test_packs: 1, late_threshold_days: 7,
        chart_colors: chartColors,
      },
    }))
    expect((await getPipingSettings('p1'))?.chartColors).toEqual({})
  })

  it('keeps an unset total as null', async () => {
    from.mockReturnValue(builder({
      data: { project_id: 'p1', enabled: false, week_start_date: '2026-09-07', total_test_packs: null, late_threshold_days: 0 },
    }))
    const s = await getPipingSettings('p1')
    expect(s?.totalTestPacks).toBeNull()
    expect(s?.lateThresholdDays).toBe(0)
    expect(s?.enabled).toBe(false)
  })

  it('returns null for a project that never had Piping', async () => {
    from.mockReturnValue(builder({ data: null }))
    expect(await getPipingSettings('p1')).toBeNull()
  })

  it('throws the error', async () => {
    from.mockReturnValue(builder({ error: { message: 'boom' } }))
    await expect(getPipingSettings('p1')).rejects.toThrow('boom')
  })
})

describe('enablePiping', () => {
  it('calls piping_enable with its four arguments', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await enablePiping('p1', INPUT)
    expect(rpc).toHaveBeenCalledWith('piping_enable', {
      p_project: 'p1', p_week_start: '2026-09-07', p_total_test_packs: 1022, p_late_threshold_days: 7,
    })
  })

  it('accepts the largest int total', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await enablePiping('p1', { ...INPUT, totalTestPacks: 2_147_483_647 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('sends an unset total as null', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await enablePiping('p1', { ...INPUT, totalTestPacks: null })
    expect(rpc.mock.calls[0][1]).toHaveProperty('p_total_test_packs', null)
  })

  it.each([
    [{ ...INPUT, weekStartDate: '' }, /ngày bắt đầu tuần/],
    [{ ...INPUT, totalTestPacks: -1 }, /Tổng Test Pack/],
    [{ ...INPUT, totalTestPacks: 1.5 }, /Tổng Test Pack/],
    [{ ...INPUT, totalTestPacks: 2_147_483_648 }, /Tổng Test Pack/],
    [{ ...INPUT, weekStartDate: '2026-02-30' }, /ngày bắt đầu tuần/],
    [{ ...INPUT, lateThresholdDays: 366 }, /Ngưỡng trễ/],
    [{ ...INPUT, lateThresholdDays: Number.NaN }, /Ngưỡng trễ/],
  ])('refuses %o before calling', async (input, message) => {
    await expect(enablePiping('p1', input)).rejects.toThrow(message)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("keeps the function's Vietnamese refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Chỉ admin được bật Piping' } })
    await expect(enablePiping('p1', INPUT)).rejects.toThrow('Chỉ admin được bật Piping')
  })
})

describe('updatePipingSettings', () => {
  it('updates the three settings of the project and checks a row was written', async () => {
    const b = builder({ data: [{ project_id: 'p1' }] })
    from.mockReturnValue(b)
    await updatePipingSettings('p1', INPUT)
    expect(b.update).toHaveBeenCalledWith({ week_start_date: '2026-09-07', total_test_packs: 1022, late_threshold_days: 7 })
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(b.select).toHaveBeenCalled()
  })

  it('reports a write RLS swallowed', async () => {
    from.mockReturnValue(builder({ data: [] }))
    await expect(updatePipingSettings('p1', INPUT)).rejects.toThrow(NOT_SAVED)
  })

  it('writes chart colours only when given, so a settings save keeps them', async () => {
    const b = builder({ data: [{ project_id: 'p1' }] })
    from.mockReturnValue(b)
    await updatePipingSettings('p1', { ...INPUT, chartColors: { 'rein.planBar': '#1677ff' } })
    expect(b.update).toHaveBeenCalledWith({
      week_start_date: '2026-09-07', total_test_packs: 1022, late_threshold_days: 7,
      chart_colors: { 'rein.planBar': '#1677ff' },
    })
  })

  it('writes an empty map to restore the defaults', async () => {
    const b = builder({ data: [{ project_id: 'p1' }] })
    from.mockReturnValue(b)
    await updatePipingSettings('p1', { ...INPUT, chartColors: {} })
    expect(b.update.mock.calls[0][0]).toHaveProperty('chart_colors', {})
  })

  it.each(['red', '#12345', '#1234567', ''])('refuses chart colour %o before writing', async (colour) => {
    await expect(updatePipingSettings('p1', { ...INPUT, chartColors: { 'rein.planBar': colour } }))
      .rejects.toThrow('Màu biểu đồ không hợp lệ')
    expect(from).not.toHaveBeenCalled()
  })

  it('validates like enable', async () => {
    await expect(updatePipingSettings('p1', { ...INPUT, lateThresholdDays: -1 })).rejects.toThrow(/Ngưỡng trễ/)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('disablePiping', () => {
  it('sets enabled = false and nothing else', async () => {
    const b = builder({ data: [{ project_id: 'p1' }] })
    from.mockReturnValue(b)
    await disablePiping('p1')
    expect(b.update).toHaveBeenCalledWith({ enabled: false })
    expect(b.eq).toHaveBeenCalledWith('project_id', 'p1')
  })

  it('maps an RLS refusal', async () => {
    from.mockReturnValue(builder({ error: { code: '42501', message: 'new row violates row-level security policy' } }))
    await expect(disablePiping('p1')).rejects.toThrow(NO_PERMISSION)
  })
})
