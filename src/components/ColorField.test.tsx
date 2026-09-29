import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigProvider, theme } from 'antd'
import { adminTheme } from '../theme'
import { describe, expect, it, vi } from 'vitest'
import { ColorField, HEX_COLOR } from './ColorField'

/**
 * The swatch-plus-hex pair StageConfigPanel has carried since the hex field
 * was added, extracted so the KPI colour table (RV6-28) can reuse it. The
 * panel's own suite still asserts the pair's behaviour end to end (save
 * payload, locked save on a half-typed hex); this file pins the contract the
 * two callers share: what each input reports, and when.
 */
const renderField = (over: Partial<Parameters<typeof ColorField>[0]> = {}) => {
  const onColor = vi.fn()
  const onHex = vi.fn()
  render(
    <ColorField label="Blast + Coat 1" value="#fadb14" onColor={onColor} onHex={onHex} {...over} />,
  )
  return { onColor, onHex }
}

describe('HEX_COLOR', () => {
  it('accepts six hex digits behind a hash and nothing else', () => {
    expect(HEX_COLOR.test('#fadb14')).toBe(true)
    expect(HEX_COLOR.test('#FADB14')).toBe(true)
    expect(HEX_COLOR.test('#abc')).toBe(false)
    expect(HEX_COLOR.test('fadb14')).toBe(false)
    expect(HEX_COLOR.test('#fadb1')).toBe(false)
    expect(HEX_COLOR.test('#fadb144')).toBe(false)
    expect(HEX_COLOR.test('#fadb1g')).toBe(false)
  })
})

describe('ColorField', () => {
  it('shows the colour in both the swatch and the hex field, named by the label', () => {
    renderField()
    expect(screen.getByLabelText('Chọn màu · Blast + Coat 1')).toHaveValue('#fadb14')
    const hex = screen.getByLabelText('Mã màu · Blast + Coat 1')
    expect(hex).toHaveValue('#fadb14')
    expect(hex).not.toHaveAttribute('aria-invalid')
  })

  it('shows the typed draft over the colour, and marks it invalid while it is not a colour', () => {
    renderField({ hex: '#12' })
    expect(screen.getByLabelText('Mã màu · Blast + Coat 1')).toHaveValue('#12')
    expect(screen.getByLabelText('Mã màu · Blast + Coat 1')).toHaveAttribute('aria-invalid', 'true')
    // The swatch keeps the last real colour: it cannot display "#12".
    expect(screen.getByLabelText('Chọn màu · Blast + Coat 1')).toHaveValue('#fadb14')
  })

  it('reports a complete typed hex as a colour, lowercased, and the text as typed', () => {
    const { onColor, onHex } = renderField()
    fireEvent.change(screen.getByLabelText('Mã màu · Blast + Coat 1'), { target: { value: '#123ABC' } })
    expect(onHex).toHaveBeenCalledWith('#123ABC')
    expect(onColor).toHaveBeenCalledWith('#123abc')
  })

  it('does not report a half-typed hex as a colour', () => {
    const { onColor, onHex } = renderField()
    fireEvent.change(screen.getByLabelText('Mã màu · Blast + Coat 1'), { target: { value: '#12' } })
    expect(onHex).toHaveBeenCalledWith('#12')
    expect(onColor).not.toHaveBeenCalled()
  })

  it('reports a swatch pick as both the colour and the hex text', () => {
    const { onColor, onHex } = renderField()
    fireEvent.change(screen.getByLabelText('Chọn màu · Blast + Coat 1'), { target: { value: '#123abc' } })
    expect(onColor).toHaveBeenCalledWith('#123abc')
    expect(onHex).toHaveBeenCalledWith('#123abc')
  })

  it('routes a swatch pick to onSwatchColor when the caller separates it, and reports the swatch losing focus', () => {
    const onSwatchColor = vi.fn()
    const onSwatchBlur = vi.fn()
    const { onColor, onHex } = renderField({ onSwatchColor, onSwatchBlur })
    const swatch = screen.getByLabelText('Chọn màu · Blast + Coat 1')
    fireEvent.change(swatch, { target: { value: '#123abc' } })
    expect(onSwatchColor).toHaveBeenCalledWith('#123abc')
    expect(onColor).not.toHaveBeenCalled()
    expect(onHex).toHaveBeenCalledWith('#123abc')
    fireEvent.blur(swatch)
    expect(onSwatchBlur).toHaveBeenCalledTimes(1)
    // The hex field still reports through onColor: only the swatch is split off.
    fireEvent.change(screen.getByLabelText('Mã màu · Blast + Coat 1'), { target: { value: '#abcdef' } })
    expect(onColor).toHaveBeenCalledWith('#abcdef')
    expect(onSwatchColor).toHaveBeenCalledTimes(1)
  })

  it('tells the caller when the hex field loses focus', () => {
    const onHexBlur = vi.fn()
    renderField({ onHexBlur })
    fireEvent.blur(screen.getByLabelText('Mã màu · Blast + Coat 1'))
    expect(onHexBlur).toHaveBeenCalledTimes(1)
  })

  it('draws the swatch as a plain circle: no border, no padding, no input chrome (CLR-01)', () => {
    renderField()
    const swatch = screen.getByLabelText('Chọn màu · Blast + Coat 1')
    expect(swatch).toHaveClass('pp-swatch')
    expect(swatch).not.toHaveClass('ant-input')
    expect(swatch).toHaveStyle({ borderRadius: '50%', padding: '0px', appearance: 'none' })
    expect(swatch.style.borderStyle === 'none' || swatch.style.border === '0px').toBe(true)
    expect(swatch.style.width).toBe(swatch.style.height)
  })

  it('sizes the circle to the height of the controls in its row (CLR-01, CTL-01)', () => {
    const token = theme.getDesignToken(adminTheme)
    const { unmount } = render(
      <ConfigProvider theme={adminTheme}>
        <ColorField label="A" value="#fadb14" onColor={vi.fn()} onHex={vi.fn()} />
      </ConfigProvider>,
    )
    expect(screen.getByLabelText('Chọn màu · A')).toHaveStyle({ width: `${token.controlHeight}px` })
    unmount()
    render(
      <ConfigProvider theme={adminTheme}>
        <ColorField size="small" label="A" value="#fadb14" onColor={vi.fn()} onHex={vi.fn()} />
      </ConfigProvider>,
    )
    expect(screen.getByLabelText('Chọn màu · A')).toHaveStyle({
      width: `${token.controlHeightSM}px`,
      height: `${token.controlHeightSM}px`,
    })
  })

  it('disables both inputs together', () => {
    renderField({ disabled: true })
    expect(screen.getByLabelText('Chọn màu · Blast + Coat 1')).toBeDisabled()
    expect(screen.getByLabelText('Mã màu · Blast + Coat 1')).toBeDisabled()
  })
})
