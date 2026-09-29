import { render } from '@testing-library/react'
import { Button, Input, InputNumber } from 'antd'
import { describe, expect, it } from 'vitest'
import { expectAllSmall } from './controls'

describe('expectAllSmall (CTL-01)', () => {
  it('passes a row whose controls are all small, a field with an addon included', () => {
    const { container } = render(
      <div>
        <Input size="small" aria-label="a" />
        <Input size="small" aria-label="b" addonAfter="%" />
        <InputNumber size="small" aria-label="c" addonAfter="m²" />
        <Button size="small">x</Button>
      </div>,
    )
    expectAllSmall(container)
  })

  it.each([
    ['a bare Input', () => <Input aria-label="a" />],
    ['an Input with an addon', () => <Input aria-label="b" addonAfter="%" />],
    ['an InputNumber with an addon', () => <InputNumber aria-label="c" addonAfter="m²" />],
    ['a Button', () => <Button>x</Button>],
  ])('fails a row holding %s at the default size', (_n, ui) => {
    const { container } = render(<div><Button size="small">ok</Button>{ui()}</div>)
    expect(() => expectAllSmall(container)).toThrow()
  })
})
