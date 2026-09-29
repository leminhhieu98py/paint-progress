import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryBadge } from './CategoryBadge'
import { CATEGORY_TONE, type CategoryValue } from './categoryTone'

const paint = (el: HTMLElement) => `${el.style.background}|${el.style.color}`

describe('CategoryBadge', () => {
  it.each(Object.keys(CATEGORY_TONE) as (keyof typeof CATEGORY_TONE)[])(
    'gives every %s value its own colour',
    (category) => {
      const values = Object.keys(CATEGORY_TONE[category]) as CategoryValue<typeof category>[]
      render(<>{values.map((v) => <CategoryBadge key={v} category={category} value={v} />)}</>)
      const paints = new Set(values.map((v) => paint(screen.getByText(v))))
      expect(paints.size).toBe(values.length)
    },
  )

  it('renders the value as its label', () => {
    render(<CategoryBadge category="role" value="Visitor" />)
    expect(screen.getByText('Visitor')).toBeInTheDocument()
  })

  it('covers the fixed sets the screens show', () => {
    expect(Object.keys(CATEGORY_TONE.role)).toEqual(['GS', 'Visitor'])
    expect(Object.keys(CATEGORY_TONE.accountStatus)).toEqual(['Đang dùng', 'Đã khoá', 'Đã ẩn'])
    expect(Object.keys(CATEGORY_TONE.workKind)).toEqual(['Theo ô', 'Nhập tay'])
    expect(Object.keys(CATEGORY_TONE.counts)).toEqual(['Có', 'Không'])
    expect(Object.keys(CATEGORY_TONE.drawing)).toEqual(['Đã có', 'Chưa có'])
  })
})

describe('CategoryBadge types', () => {
  it('accepts only the labels its category knows, so a renamed label is a type error', () => {
    // @ts-expect-error -- not a role label; a screen label renamed away from
    // the map would otherwise fall back to grey with nothing saying so.
    render(<CategoryBadge category="role" value="Quản trị" />)
    render(<CategoryBadge category="role" value="GS" />)
    expect(screen.getByText('GS')).toBeInTheDocument()
  })
})
