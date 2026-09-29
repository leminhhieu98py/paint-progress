import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { palette } from '../theme'
import { InfoTip } from './InfoTip'

const TEXT = 'Tổng Mhr chia tổng m², khác với hiệu suất trung bình theo ngày'

describe('InfoTip', () => {
  it('is a small (?) icon named by the text it explains', () => {
    render(<InfoTip text={TEXT} />)
    const tip = screen.getByRole('img', { name: TEXT })
    expect(tip).toHaveClass('anticon-question-circle')
    expect(tip).toHaveStyle({ color: palette.textTertiary })
  })

  it('shows the text on hover', async () => {
    const user = userEvent.setup()
    render(<InfoTip text={TEXT} />)
    await user.hover(screen.getByRole('img', { name: TEXT }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TEXT)
  })

  it('is reachable by keyboard and shows the text on focus', async () => {
    const user = userEvent.setup()
    render(<InfoTip text={TEXT} />)
    await user.tab()
    const tip = screen.getByRole('img', { name: TEXT })
    expect(tip).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TEXT)
  })

  it('sits inline right after the label it explains', () => {
    render(
      <span>
        Mhr/m² tổng thể
        <InfoTip text={TEXT} />
      </span>,
    )
    const tip = screen.getByRole('img', { name: TEXT })
    expect(tip.parentElement).toHaveTextContent(/^Mhr\/m² tổng thể$/)
    expect(tip).toHaveStyle({ marginInlineStart: '4px' })
  })
})
