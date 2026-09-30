import { describe, expect, it } from 'vitest'
import {
  deckUnitOf,
  DEFAULT_QUANTITY_LABEL, DEFAULT_UNIT, labelOfWorks, perUnit, quantityHeading, rateUnit, unitOfWorks,
} from './unit'

describe('defaults', () => {
  it('are what 0036 gives every existing work, so nothing reads differently until an admin edits', () => {
    expect(DEFAULT_QUANTITY_LABEL).toBe('Diện tích')
    expect(DEFAULT_UNIT).toBe('m²')
  })
})

describe('unitOfWorks', () => {
  it('is the one unit every work shares', () => {
    expect(unitOfWorks([{ unit: 'm²' }])).toBe('m²')
    expect(unitOfWorks([{ unit: 'm²' }, { unit: 'm²' }, { unit: 'm²' }])).toBe('m²')
    expect(unitOfWorks([{ unit: 'tấn' }, { unit: 'tấn' }])).toBe('tấn')
  })

  it('is null when the works disagree -- a sum across them would add apples to oranges', () => {
    expect(unitOfWorks([{ unit: 'm²' }, { unit: 'm' }])).toBeNull()
    expect(unitOfWorks([{ unit: 'm²' }, { unit: 'm²' }, { unit: 'kg' }])).toBeNull()
  })

  it('is null for no works at all: there is no unit to name', () => {
    expect(unitOfWorks([])).toBeNull()
  })

  it('compares the stored text as it is, so a different spelling is a different unit', () => {
    expect(unitOfWorks([{ unit: 'm²' }, { unit: 'm2' }])).toBeNull()
    expect(unitOfWorks([{ unit: 'm²' }, { unit: 'M²' }])).toBeNull()
  })
})

describe('labelOfWorks', () => {
  it('is the one label every work shares', () => {
    expect(labelOfWorks([{ quantityLabel: 'Diện tích' }])).toBe('Diện tích')
    expect(labelOfWorks([{ quantityLabel: 'Khối lượng' }, { quantityLabel: 'Khối lượng' }])).toBe('Khối lượng')
  })

  it('is null when they differ, and for no works', () => {
    expect(labelOfWorks([{ quantityLabel: 'Diện tích' }, { quantityLabel: 'Chiều dài' }])).toBeNull()
    expect(labelOfWorks([])).toBeNull()
  })
})

describe('label builders', () => {
  it('quantityHeading reads "<label> (<unit>)", the heading every table used to hard-code', () => {
    expect(quantityHeading('Diện tích', 'm²')).toBe('Diện tích (m²)')
    expect(quantityHeading('Chiều dài', 'm')).toBe('Chiều dài (m)')
    expect(quantityHeading(DEFAULT_QUANTITY_LABEL, DEFAULT_UNIT)).toBe('Diện tích (m²)')
  })

  it('rateUnit is the KPI axis, "<unit>/ngày"', () => {
    expect(rateUnit('m²')).toBe('m²/ngày')
    expect(rateUnit('tấn')).toBe('tấn/ngày')
  })

  it('perUnit is the efficiency figure, "Mhr/<unit>"', () => {
    expect(perUnit('m²')).toBe('Mhr/m²')
    expect(perUnit('m')).toBe('Mhr/m')
  })
})

describe('deckUnitOf (AD4)', () => {
  it('is the unit every work of the deck shares', () => {
    expect(deckUnitOf([{ unit: 'tấn', seq: 2 }, { unit: 'tấn', seq: 1 }])).toBe('tấn')
  })
  it('is m² for a deck in no work yet', () => {
    expect(deckUnitOf([])).toBe('m²')
  })
  it('falls back to its first work\'s unit, by seq, when its works disagree: never a bare figure', () => {
    expect(deckUnitOf([{ unit: 'tấn', seq: 2 }, { unit: 'm²', seq: 1 }])).toBe('m²')
    expect(deckUnitOf([{ unit: 'Kg', seq: 1 }, { unit: 'm²', seq: 3 }])).toBe('Kg')
  })
})
