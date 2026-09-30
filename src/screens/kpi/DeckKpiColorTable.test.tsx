import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { weightOf } from '../../test/typography'
import { expectOneHeight } from '../../test/controls'
import { DeckKpiColorTable, type DeckKpiColorRow } from './DeckKpiColorTable'
import { keyFactTexts } from '../../test/copy'

/**
 * RV6-28's admin table and RV6-31's rule on a bad hex. The two fields are
 * `ColorField`, whose own suite pins what each input reports; what this file
 * checks is what the table does with those reports: which deck, which family,
 * what payload, and what the field shows once the admin moves on.
 */

const DECKS: DeckKpiColorRow[] = [
  { id: 'd1', name: 'Sàn A', kpiPlanColor: '#123abc', kpiActualColor: null },
  { id: 'd2', name: 'Sàn B', kpiPlanColor: null, kpiActualColor: null },
]

const renderTable = (over: { decks?: DeckKpiColorRow[]; saving?: boolean } = {}) => {
  const onChange = vi.fn()
  render(<DeckKpiColorTable decks={over.decks ?? DECKS} onChange={onChange} saving={over.saving ?? false} />)
  return { onChange }
}

/** The section starts shut; every test that reaches a field opens it first. */
const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Màu biểu đồ theo sàn' }))
}

describe('DeckKpiColorTable', () => {
  it('stands the colour fields and Mặc định at the theme height (CTL-02)', async () => {
    renderTable()
    await open()
    expectOneHeight(screen.getByTestId('deck-color-row-d1'))
  })

  it('sets the deck name as body text, not bold (TYP-02)', async () => {
    renderTable()
    await open()
    expect(weightOf(screen.getByText('Sàn A'))).toBe(400)
  })

  it('is a collapsible section, shut by default, that counts the styled decks', () => {
    renderTable()
    expect(screen.getByRole('heading', { name: 'Màu biểu đồ theo sàn' })).toBeInTheDocument()
    expect(keyFactTexts()).toEqual(['2 sàn', '1 sàn có màu riêng'])
    expect(screen.getByRole('button', { name: 'Màu biểu đồ theo sàn' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Mã màu · Kế hoạch · Sàn A')).toBeNull()
  })

  it('shows one row per deck with a Plan and an Actual field and a reset link', async () => {
    renderTable()
    await open()
    for (const name of ['Sàn A', 'Sàn B']) {
      expect(screen.getByLabelText(`Chọn màu · Kế hoạch · ${name}`)).toBeInTheDocument()
      expect(screen.getByLabelText(`Mã màu · Kế hoạch · ${name}`)).toBeInTheDocument()
      expect(screen.getByLabelText(`Chọn màu · Thực hiện · ${name}`)).toBeInTheDocument()
      expect(screen.getByLabelText(`Mã màu · Thực hiện · ${name}`)).toBeInTheDocument()
      expect(within(screen.getByTestId(`deck-color-row-${name === 'Sàn A' ? 'd1' : 'd2'}`)).getByRole('button', { name: `Mặc định · ${name}` }))
        .toHaveTextContent('Mặc định')
    }
  })

  it('shows the stored colour, and the system default where none is stored (RV6-30)', async () => {
    renderTable()
    await open()
    expect(screen.getByLabelText('Mã màu · Kế hoạch · Sàn A')).toHaveValue('#123abc')
    // The defaults are the chart's own: plan grey, actual accent.
    expect(screen.getByLabelText('Mã màu · Thực hiện · Sàn A')).toHaveValue('#0a8175')
    expect(screen.getByLabelText('Mã màu · Kế hoạch · Sàn B')).toHaveValue('#8698aa')
  })

  describe('swatch drag', () => {
    /**
     * The native picker reports every step of a drag as a change. Each one
     * used to be a write plus a full reload; now the swatch follows the drag
     * and the table writes once, when the drag has settled or the swatch is
     * left. Fake timers go on after `open()`, which drives userEvent.
     */
    afterEach(() => { vi.useRealTimers() })
    const drag = (label: string, ...steps: string[]) => {
      for (const value of steps) fireEvent.change(screen.getByLabelText(`Chọn màu · ${label}`), { target: { value } })
    }
    const settle = (ms = 400) => { act(() => { vi.advanceTimersByTime(ms) }) }

    it('follows the drag at once and writes the last step once, 400 ms after it, with the other family left as stored', async () => {
      const { onChange } = renderTable()
      await open()
      vi.useFakeTimers()
      drag('Thực hiện · Sàn A', '#111111', '#222222', '#333333', '#444444', '#0000ff')
      expect(screen.getByLabelText('Chọn màu · Thực hiện · Sàn A')).toHaveValue('#0000ff')
      expect(onChange).not.toHaveBeenCalled()
      settle(399)
      expect(onChange).not.toHaveBeenCalled()
      settle(1)
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('d1', { plan: '#123abc', actual: '#0000ff' })
    })

    it('writes at once when the swatch loses focus before the drag has settled, and not again after', async () => {
      const { onChange } = renderTable()
      await open()
      vi.useFakeTimers()
      drag('Kế hoạch · Sàn B', '#111111', '#abcdef')
      fireEvent.blur(screen.getByLabelText('Chọn màu · Kế hoạch · Sàn B'))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('d2', { plan: '#abcdef', actual: null })
      settle()
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('writes nothing when the drag ends back on the colour the swatch started from', async () => {
      const { onChange } = renderTable()
      await open()
      vi.useFakeTimers()
      drag('Kế hoạch · Sàn A', '#0000ff', '#123abc')
      settle()
      fireEvent.blur(screen.getByLabelText('Chọn màu · Kế hoạch · Sàn A'))
      expect(onChange).not.toHaveBeenCalled()
    })

    it('lets a typed hex on the other family carry a still-pending drag along in the one write', async () => {
      const { onChange } = renderTable()
      await open()
      vi.useFakeTimers()
      drag('Kế hoạch · Sàn A', '#0000ff')
      fireEvent.change(screen.getByLabelText('Mã màu · Thực hiện · Sàn A'), { target: { value: '#00ff00' } })
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('d1', { plan: '#0000ff', actual: '#00ff00' })
      settle()
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('drops a still-pending drag when the deck is reset to the defaults', async () => {
      const { onChange } = renderTable()
      await open()
      vi.useFakeTimers()
      drag('Thực hiện · Sàn A', '#0000ff')
      fireEvent.click(screen.getByRole('button', { name: 'Mặc định · Sàn A' }))
      settle()
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('d1', { plan: null, actual: null })
    })
  })

  it('writes a complete typed hex, lowercased, the moment it is complete', async () => {
    const { onChange } = renderTable()
    await open()
    fireEvent.change(screen.getByLabelText('Mã màu · Kế hoạch · Sàn B'), { target: { value: '#ABCDEF' } })
    expect(onChange).toHaveBeenCalledWith('d2', { plan: '#abcdef', actual: null })
  })

  it('writes nothing for a hex the rule rejects, and shows the stored colour again on blur (RV6-31)', async () => {
    const { onChange } = renderTable()
    await open()
    const hex = screen.getByLabelText('Mã màu · Kế hoạch · Sàn A')
    fireEvent.change(hex, { target: { value: '#12' } })
    // The keystrokes stay while the field has focus, marked invalid.
    expect(hex).toHaveValue('#12')
    expect(hex).toHaveAttribute('aria-invalid', 'true')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(hex)
    expect(hex).toHaveValue('#123abc')
    expect(hex).not.toHaveAttribute('aria-invalid')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears both colours through the reset link', async () => {
    const { onChange } = renderTable()
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Mặc định · Sàn A' }))
    expect(onChange).toHaveBeenCalledWith('d1', { plan: null, actual: null })
  })

  it('disables the reset link on a deck already at the defaults', async () => {
    renderTable()
    await open()
    expect(screen.getByRole('button', { name: 'Mặc định · Sàn B' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mặc định · Sàn A' })).toBeEnabled()
  })

  it('disables every input while a write is in flight', async () => {
    renderTable({ saving: true })
    await open()
    expect(screen.getByLabelText('Chọn màu · Kế hoạch · Sàn A')).toBeDisabled()
    expect(screen.getByLabelText('Mã màu · Thực hiện · Sàn B')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mặc định · Sàn A' })).toBeDisabled()
  })
})
