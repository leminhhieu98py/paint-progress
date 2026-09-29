import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryBadge, WasteReasonBadge } from './CategoryBadge'
import { CATEGORY_TONE, wasteReasonTone } from './categoryTone'

const paint = (el: HTMLElement) => `${el.style.background}|${el.style.color}`

describe('CategoryBadge', () => {
  it.each(Object.keys(CATEGORY_TONE) as (keyof typeof CATEGORY_TONE)[])(
    'gives every %s value its own colour',
    (category) => {
      const values = Object.keys(CATEGORY_TONE[category])
      render(<>{values.map((v) => <CategoryBadge key={v} category={category} value={v} />)}</>)
      const paints = new Set(values.map((v) => paint(screen.getByText(v))))
      expect(paints.size).toBe(values.length)
    },
  )

  it('renders the value as its label', () => {
    render(<CategoryBadge category="role" value="Chỉ xem" />)
    expect(screen.getByText('Chỉ xem')).toBeInTheDocument()
  })

  it('covers the fixed sets the screens show', () => {
    expect(Object.keys(CATEGORY_TONE.role)).toEqual(['GS', 'Chỉ xem'])
    expect(Object.keys(CATEGORY_TONE.accountStatus)).toEqual(['Đang dùng', 'Đã khoá', 'Đã ẩn'])
    expect(Object.keys(CATEGORY_TONE.workKind)).toEqual(['Theo ô', 'Nhập tay'])
    expect(Object.keys(CATEGORY_TONE.counts)).toEqual(['Có', 'Không'])
    expect(Object.keys(CATEGORY_TONE.drawing)).toEqual(['Đã có', 'Chưa có'])
  })
})

describe('WasteReasonBadge', () => {
  it('colours a reason by its group code', () => {
    expect(wasteReasonTone('2.1 Vật tư về trễ, về không đồng bộ')).toBe(wasteReasonTone('2.5 Vật tư cấp phát sai'))
    expect(wasteReasonTone('2.1 Vật tư về trễ')).not.toBe(wasteReasonTone('3.1 Bản vẽ (Hold, change, revise)'))
    expect(wasteReasonTone('1.1 Vận chuyển')).not.toBe(wasteReasonTone('4.2 Quy trình'))
  })

  it('renders the whole reason inside the badge', () => {
    render(<WasteReasonBadge reason="8.5 Cúp điện" />)
    expect(screen.getByText('8.5 Cúp điện')).toBeInTheDocument()
  })

  it('renders nothing for an empty reason', () => {
    const { container } = render(<WasteReasonBadge reason="" />)
    expect(container).toBeEmptyDOMElement()
  })
})
