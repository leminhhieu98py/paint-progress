import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fieldType, palette } from '../theme'
import { KeyFacts } from './KeyFacts'
import { TypeScaleProvider } from './typeScale'

describe('KeyFacts (HLT-01)', () => {
  it('renders one pill per fact, value then label', () => {
    render(
      <KeyFacts
        facts={[
          { value: 2, label: 'công việc' },
          { value: 1, label: 'tính vào tổng' },
        ]}
      />,
    )
    const pills = screen.getAllByTestId('key-fact')
    expect(pills.map((p) => p.textContent)).toEqual(['2 công việc', '1 tính vào tổng'])
  })

  it('sets the value in bodyStrong and the label in caption', () => {
    render(<KeyFacts facts={[{ value: '37', label: 'công đoạn' }]} />)
    expect(screen.getByText('37')).toHaveStyle({ fontSize: '13px', fontWeight: '600' })
    expect(screen.getByText('công đoạn')).toHaveStyle({ fontSize: '12px', fontWeight: '400' })
  })

  it('reads a word before the value as a caption too, in the order it is written', () => {
    render(<KeyFacts facts={[{ prefix: 'tổng', value: '1,00' }]} />)
    const pill = screen.getByTestId('key-fact')
    expect(pill).toHaveTextContent('tổng 1,00')
    expect(within(pill).getByText('tổng')).toHaveStyle({ fontSize: '12px', fontWeight: '400' })
    expect(within(pill).getByText('1,00')).toHaveStyle({ fontWeight: '600' })
  })

  it('draws a neutral pill by default: subtle background, secondary text', () => {
    render(<KeyFacts facts={[{ value: 5, label: 'lớp' }]} />)
    expect(screen.getByTestId('key-fact')).toHaveStyle({
      background: palette.bgSubtle,
      color: palette.textSecondary,
    })
  })

  it('draws a warning pill in amber, the same shape, its explanation in a (?) tip', async () => {
    const user = userEvent.setup()
    render(
      <KeyFacts
        facts={[
          { value: '5', label: 'lớp' },
          {
            value: '522 / 980',
            label: 'lần cập nhật có ghi giờ công',
            tone: 'warning',
            info: 'Các lần chưa ghi không tính vào hiệu suất.',
          },
        ]}
      />,
    )
    const [neutral, warning] = screen.getAllByTestId('key-fact')
    expect(warning).toHaveStyle({ background: palette.warningBg, color: palette.warning })
    expect(warning.style.borderRadius).toBe(neutral.style.borderRadius)
    expect(warning.style.padding).toBe(neutral.style.padding)
    expect(warning).toHaveTextContent('522 / 980 lần cập nhật có ghi giờ công')
    const tip = within(warning).getByRole('img', { name: 'Các lần chưa ghi không tính vào hiệu suất.' })
    await user.hover(tip)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Các lần chưa ghi không tính vào hiệu suất.')
  })

  it('leaves out facts that are not there', () => {
    render(<KeyFacts facts={[{ value: 3, label: 'sàn' }, false, null, undefined]} />)
    expect(screen.getAllByTestId('key-fact')).toHaveLength(1)
  })

  it('renders nothing when no fact is there', () => {
    const { container } = render(<KeyFacts facts={[false, null]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('wraps its pills rather than overflowing a narrow row', () => {
    render(<KeyFacts facts={[{ value: 1, label: 'ô' }]} />)
    expect(screen.getByTestId('key-facts')).toHaveStyle({ display: 'inline-flex', flexWrap: 'wrap' })
  })

  it('takes the field scale on a field page (GS-10)', () => {
    render(
      <TypeScaleProvider value={fieldType}>
        <KeyFacts facts={[{ value: '1.234', label: 'm²' }]} />
      </TypeScaleProvider>,
    )
    expect(screen.getByText('1.234')).toHaveStyle({ fontSize: '14px', fontWeight: '600' })
  })
})
