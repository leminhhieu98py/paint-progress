import { render } from '@testing-library/react'
import { Button, Input, InputNumber } from 'antd'
import { describe, expect, it } from 'vitest'
import { expectOneHeight } from './controls'

describe('expectOneHeight (CTL-02)', () => {
  it('passes a row whose controls all stand at the theme height, a field with an addon included', () => {
    const { container } = render(
      <div>
        <Input aria-label="a" />
        <Input aria-label="b" addonAfter="%" />
        <InputNumber aria-label="c" addonAfter="m²" />
        <Button>x</Button>
      </div>,
    )
    expectOneHeight(container)
  })

  it.each([
    ['a small Input', () => <Input size="small" aria-label="a" />],
    ['a large Input with an addon', () => <Input size="large" aria-label="b" addonAfter="%" />],
    ['a small InputNumber', () => <InputNumber size="small" aria-label="c" />],
    ['a small Button', () => <Button size="small">x</Button>],
  ])('fails a row holding %s', (_n, ui) => {
    const { container } = render(<div><Button>ok</Button>{ui()}</div>)
    expect(() => expectOneHeight(container)).toThrow()
  })
})
