import { describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_TEMPLATE } from './stageTemplate'

describe('DEFAULT_STAGE_TEMPLATE', () => {
  it('carries the five stages from the source workbook in order', () => {
    expect(DEFAULT_STAGE_TEMPLATE.map((s) => s.name)).toEqual([
      'Blast + Coat 1',
      'Coat 2',
      'Coat 3',
      'Coat 4',
      'Tháo giáo',
    ])
  })

  it('has weights summing to exactly 1', () => {
    const total = DEFAULT_STAGE_TEMPLATE.reduce((sum, s) => sum + s.weight, 0)
    expect(total).toBeCloseTo(1, 12)
  })

  it('numbers seq 1..5 with no gaps', () => {
    expect(DEFAULT_STAGE_TEMPLATE.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('carries no id field, so it is insertable as-is', () => {
    // WORKBOOK_STAGES has string ids like 'coat1' which are not uuids and
    // cannot be inserted into project_stages.id. This template exists so a
    // caller never reaches for that one by mistake.
    for (const entry of DEFAULT_STAGE_TEMPLATE) {
      expect(entry).not.toHaveProperty('id')
    }
  })

  it('gives every stage a distinct hex colour', () => {
    const colors = DEFAULT_STAGE_TEMPLATE.map((s) => s.color)
    expect(new Set(colors).size).toBe(colors.length)
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
