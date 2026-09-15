import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeckKpiColorTable, type DeckKpiColorRow } from './DeckKpiColorTable'

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
  it('is a collapsible section, shut by default, that counts the styled decks', () => {
    renderTable()
    expect(screen.getByRole('heading', { name: 'Màu biểu đồ theo sàn' })).toBeInTheDocument()
    expect(screen.getByText('2 sàn · 1 sàn có màu riêng')).toBeInTheDocument()
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

  it('writes a swatch pick with the other family left as stored', async () => {
    const { onChange } = renderTable()
    await open()
    fireEvent.change(screen.getByLabelText('Chọn màu · Thực hiện · Sàn A'), { target: { value: '#0000ff' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('d1', { plan: '#123abc', actual: '#0000ff' })
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
