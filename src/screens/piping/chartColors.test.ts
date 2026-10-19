import { describe, expect, it } from 'vitest'
import type { ManpowerGroup } from '../../domain/piping/types'
import { palette } from '../../theme'
import { KPI_COLOR_DEFAULTS } from '../dashboard/kpiColors'
import { chartColorSections, groupColorKey, insulationColorKey, resolveChartColors } from './chartColors'

const group = (id: string, sort: number, hidden = false): ManpowerGroup => ({ id, name: `Nhóm ${id}`, sort, hidden })

describe('resolveChartColors (RV8-2)', () => {
  it('gives every key today\'s colour when nothing is stored', () => {
    const colors = resolveChartColors({}, [group('a', 1), group('b', 2)])
    expect(colors).toEqual({
      'rein.planBar': KPI_COLOR_DEFAULTS.plan,
      'rein.actualBar': KPI_COLOR_DEFAULTS.actual,
      'rein.planCum': palette.textTertiary,
      'rein.actualCum': palette.accentHover,
      'mp.group.a': palette.categorical[0],
      'mp.group.b': palette.categorical[1],
      'mp.planTotal': palette.textTertiary,
      'mp.actualTotal': palette.ink,
      'mp.planAvg': palette.warning,
      'ins.ph.plan': palette.categorical[0],
      'ins.ph.actual': palette.categorical[0],
      'ins.ih.plan': palette.categorical[2],
      'ins.ih.actual': palette.categorical[2],
      'ins.iw.plan': palette.categorical[6],
      'ins.iw.actual': palette.categorical[6],
    })
  })

  it('colours a group by its place in the list given, the palette repeating past eight', () => {
    const groups = Array.from({ length: 10 }, (_, i) => group(`g${i}`, i))
    const colors = resolveChartColors({}, groups)
    expect(colors[groupColorKey('g7')]).toBe(palette.categorical[7])
    expect(colors[groupColorKey('g9')]).toBe(palette.categorical[1])
  })

  it('takes a stored colour over the default', () => {
    const colors = resolveChartColors(
      { 'rein.planCum': '#123456', 'mp.group.b': '#ABCDEF', 'ins.ih.actual': '#00ff00' },
      [group('a', 1), group('b', 2)],
    )
    expect(colors['rein.planCum']).toBe('#123456')
    expect(colors[groupColorKey('b')]).toBe('#ABCDEF')
    expect(colors[insulationColorKey('ih', 'actual')]).toBe('#00ff00')
    // The other kind of the same milestone keeps its default.
    expect(colors[insulationColorKey('ih', 'plan')]).toBe(palette.categorical[2])
  })

  it('ignores an invalid stored value, keeping the default', () => {
    const colors = resolveChartColors(
      { 'rein.planBar': 'red', 'rein.actualBar': '#12345', 'mp.planAvg': '#12345678', 'mp.group.a': '' },
      [group('a', 1)],
    )
    expect(colors['rein.planBar']).toBe(KPI_COLOR_DEFAULTS.plan)
    expect(colors['rein.actualBar']).toBe(KPI_COLOR_DEFAULTS.actual)
    expect(colors['mp.planAvg']).toBe(palette.warning)
    expect(colors[groupColorKey('a')]).toBe(palette.categorical[0])
  })

  it('drops a stored key that names nothing drawn', () => {
    expect(resolveChartColors({ 'mp.group.gone': '#123456', other: '#123456' }, [])).not.toHaveProperty('mp.group.gone')
  })
})

describe('chartColorSections (Cấu hình · Màu biểu đồ)', () => {
  it('lists Reinstatement, Manpower (one row per group, hidden marked) and Insulation, each key named', () => {
    const sections = chartColorSections([group('a', 1), group('b', 2, true)])
    expect(sections.map((s) => s.title)).toEqual(['Reinstatement', 'Manpower', 'Insulation'])
    expect(sections[0].rows).toEqual([
      { key: 'rein.planBar', label: 'Plan theo ngày/tuần' },
      { key: 'rein.actualBar', label: 'Actual theo ngày/tuần' },
      { key: 'rein.planCum', label: 'Plan lũy kế' },
      { key: 'rein.actualCum', label: 'Actual lũy kế' },
    ])
    expect(sections[1].rows).toEqual([
      { key: 'mp.group.a', label: 'Nhóm a' },
      { key: 'mp.group.b', label: 'Nhóm b (ẩn)' },
      { key: 'mp.planTotal', label: 'Plan tổng' },
      { key: 'mp.actualTotal', label: 'Actual tổng' },
      { key: 'mp.planAvg', label: 'Plan TB' },
    ])
    expect(sections[2].rows).toEqual([
      { key: 'ins.ph.plan', label: 'Pip Plan' },
      { key: 'ins.ph.actual', label: 'Pip Act' },
      { key: 'ins.ih.plan', label: 'Paint Plan' },
      { key: 'ins.ih.actual', label: 'Paint Act' },
      { key: 'ins.iw.plan', label: 'Insu Plan' },
      { key: 'ins.iw.actual', label: 'Insu Act' },
    ])
  })
})
