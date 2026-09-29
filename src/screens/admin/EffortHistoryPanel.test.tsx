import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_EFFORT, type DeckEvent } from '../../domain/types'
import { EffortHistoryPanel } from './EffortHistoryPanel'
import { expectLeft } from '../../test/alignment'
import { palette } from '../../theme'

const setCellEventEffort = vi.hoisted(() => vi.fn())
const listGsUsers = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  setCellEventEffort: (id: number, effort: unknown) => setCellEventEffort(id, effort),
}))
vi.mock('../../lib/adminApi', () => ({
  listGsUsers: (includeHidden: boolean) => listGsUsers(includeHidden),
}))
const listCoworkerNames = vi.hoisted(() => vi.fn())
vi.mock('../../lib/gsApi', () => ({
  listCoworkerNames: () => listCoworkerNames(),
}))
// The roster the crew names come from, as on the GS's cell dialog (M21).
const listEmployees = vi.hoisted(() => vi.fn())
vi.mock('../../lib/employeesApi', () => ({
  listEmployees: (includeRetired?: boolean) => listEmployees(includeRetired),
}))

const ev = (over: Partial<DeckEvent> = {}): DeckEvent => ({
  id: 1, deckName: 'Cellar Deck', cellCode: 'R1C1', cellAreaM2: 100, workName: 'Sơn', toStageName: 'Lớp 1',
  at: '2026-09-01T03:00:00Z', byId: 'u1', note: '', reportNote: null, reportHidden: false,
  effort: EMPTY_EFFORT, effortEditedAt: null, effortEditedByName: null,
  ...over,
})

// Oldest first, as the API returns them.
const EVENTS = [
  ev({ id: 1, cellCode: 'R1C1', at: '2026-09-01T03:00:00Z' }),
  ev({
    id: 2, cellCode: 'R1C2', toStageName: 'Lớp 2', at: '2026-09-02T03:00:00Z', byId: 'u2',
    effort: { leadName: 'Tổ 1', painterName: 'Nam', workHours: 3.5, wasteHours: 0.5, wasteReason: 'Chờ vật tư', wasteOrder: 'LSX-1' },
    effortEditedAt: '2026-09-05T02:00:00Z', effortEditedByName: 'Đoàn Công Linh',
  }),
]

const onRetry = vi.fn()
const onSaved = vi.fn()

const renderPanel = (editable = true, over: { events?: DeckEvent[] | null; error?: string | null } = {}) =>
  render(
    <AntApp>
      <EffortHistoryPanel
        deckId="d1"
        editable={editable}
        events={over.events === undefined ? EVENTS : over.events}
        error={over.error ?? null}
        onRetry={onRetry}
        onSaved={onSaved}
      />
    </AntApp>,
  )

const rows = () => screen.getAllByRole('row').slice(1)

beforeEach(() => {
  setCellEventEffort.mockReset()
  listGsUsers.mockReset()
  onRetry.mockReset()
  onSaved.mockReset()
  listGsUsers.mockResolvedValue([{ id: 'u2', fullName: 'Trần Thị B' }])
  // u1 is an admin: not on the GS list, named through coworker_names.
  listCoworkerNames.mockReset()
  listCoworkerNames.mockResolvedValue({ u1: 'Lê Văn A' })
  listEmployees.mockReset()
  listEmployees.mockResolvedValue([
    { id: 'e1', fullName: 'Lê Văn A', active: true },
    { id: 'e2', fullName: 'Nguyễn Văn B', active: true },
  ])
})

/** Picks an option in the dropdown of ONE named Select of the dialog. */
const chooseIn = async (name: string, option: string) => {
  const box = screen.getByRole('combobox', { name })
  await userEvent.click(box)
  const dropdown = document.getElementById(box.getAttribute('aria-controls') ?? '')
    ?.closest('.ant-select-dropdown') as HTMLElement
  await userEvent.click(await within(dropdown).findByTitle(option))
}

describe('EffortHistoryPanel', () => {
  it('carries its page code, after the two progress cards (UX-03)', async () => {
    renderPanel()
    expect(await screen.findByText('A3.7')).toBeInTheDocument()
  })

  it('lists every update newest first, with the author, the crew and the hours', async () => {
    renderPanel()
    expect(await screen.findByText('R1C2')).toBeInTheDocument()
    // Hidden accounts too: a bay ticked by someone since hidden is still theirs.
    expect(listGsUsers).toHaveBeenCalledWith(true)

    const [first, second] = rows()
    expect(within(first).getByText('R1C2')).toBeInTheDocument()
    expect(within(first).getByText('Trần Thị B')).toBeInTheDocument()
    expect(within(first).getByText('Tổ 1')).toBeInTheDocument()
    expect(within(first).getByText('Nam')).toBeInTheDocument()
    expect(within(first).getByText('3,50')).toBeInTheDocument()
    expect(within(first).getByText('0,50')).toBeInTheDocument()
    expect(within(first).getByText('Chờ vật tư')).toBeInTheDocument()
    expect(within(first).getByText('đã sửa')).toBeInTheDocument()
    expect(within(second).getByText('R1C1')).toBeInTheDocument()
    expect(within(second).getByText('Lê Văn A')).toBeInTheDocument()
    expect(within(second).queryByText('đã sửa')).toBeNull()

    // A data-quality fact: amber, its explanation in a (?) (HLT-01).
    const [coverage] = screen.getAllByTestId('key-fact')
    expect(coverage).toHaveTextContent('1 / 2 lần cập nhật có ghi giờ công')
    expect(coverage).toHaveStyle({ background: palette.warningBg })
    expect(within(coverage).getByRole('img', { name: 'Các lần chưa ghi không tính vào hiệu suất.' })).toBeInTheDocument()
  })

  it('marks every empty cell of an update with no effort "-" (I7)', async () => {
    renderPanel(true, { events: [ev({ id: 1, cellCode: 'R1C1', workName: null, byId: null })] })
    const row = (await screen.findByText('R1C1')).closest('tr') as HTMLElement
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    const cell = (label: string) => row.querySelectorAll('td')[headers.indexOf(label)]
    for (const label of ['Công việc', 'Bởi', 'Nhóm trưởng', 'Thợ chính', 'Giờ công', 'Giờ hao phí', 'Lý do hao phí', 'Lệnh sản xuất']) {
      expect(cell(label)).toHaveTextContent(/^-$/)
    }
  })

  it('draws the coverage as a plain fact once every update has hours (HLT-01)', async () => {
    renderPanel(true, { events: [EVENTS[1]] })
    const [coverage] = await screen.findAllByTestId('key-fact')
    expect(coverage).toHaveTextContent('1 / 1 lần cập nhật có ghi giờ công')
    expect(coverage).toHaveStyle({ background: palette.bgSubtle })
    expect(within(coverage).queryByRole('img')).toBeNull()
  })

  it('filters to the updates still missing hours', async () => {
    renderPanel()
    expect(await screen.findByText('R1C2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch'))
    expect(screen.queryByText('R1C2')).toBeNull()
    expect(screen.getByText('R1C1')).toBeInTheDocument()
  })

  it('offers no edit outside Sửa mode', async () => {
    renderPanel(false)
    expect(await screen.findByText('R1C2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull()
  })

  it('backfills the effort on one update through the RPC and reloads', async () => {
    setCellEventEffort.mockResolvedValue(undefined)
    renderPanel()
    expect(await screen.findByText('R1C2')).toBeInTheDocument()

    const [, legacy] = rows()
    await userEvent.click(within(legacy).getByRole('button', { name: 'Sửa' }))
    expect(await screen.findByText('Giờ công · Ô R1C1 · Lớp 1')).toBeInTheDocument()
    // From the roster, as the GS picks it (M21).
    await chooseIn('Nhóm trưởng', 'Lê Văn A')
    await userEvent.type(screen.getByLabelText('Số giờ công (Mhr)'), '4')
    // A reason is asked for only once hours were lost.
    expect(screen.queryByRole('combobox', { name: 'Lý do hao phí' })).toBeNull()
    expect(screen.queryByLabelText('Lệnh sản xuất hao phí')).toBeNull()
    await userEvent.type(screen.getByLabelText('Giờ hao phí (Mhr)'), '1')
    await userEvent.type(await screen.findByLabelText('Lệnh sản xuất hao phí'), 'LSX-5')
    // The same fixed list the foreman picks from, so a backfilled row groups
    // with the recorded ones instead of becoming its own category.
    const reason = screen.getByRole('combobox', { name: 'Lý do hao phí' })
    await userEvent.click(reason)
    await userEvent.type(reason, 'Thời tiết')
    const listId = reason.getAttribute('aria-controls')
    const dropdown = document.getElementById(listId ?? '')?.closest('.ant-select-dropdown') as HTMLElement
    await userEvent.click(await within(dropdown).findByTitle('8.1 Thời tiết'))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(setCellEventEffort).toHaveBeenCalledWith(1, {
      leadName: 'Lê Văn A', painterName: '', workHours: 4, wasteHours: 1,
      wasteReason: '8.1 Thời tiết', wasteOrder: 'LSX-5',
    }))
    expect((await screen.findAllByText('Đã lưu giờ công')).length).toBeGreaterThan(0)
    // The screen owns the read; the panel only says it should happen again.
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('picks the crew from the roster and keeps a name typed before it, marked as such (M21)', async () => {
    setCellEventEffort.mockResolvedValue(undefined)
    renderPanel()
    expect(await screen.findByText('R1C2')).toBeInTheDocument()
    // Newest first: R1C2 carries "Tổ 1" and "Nam", neither on the roster.
    await userEvent.click(within(rows()[0]).getByRole('button', { name: 'Sửa' }))
    await screen.findByText('Giờ công · Ô R1C2 · Lớp 2')
    expect(listEmployees).toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Nhóm trưởng' })).toBeNull()
    expect(screen.getByTitle('Tổ 1 (ghi tự do cũ)')).toBeInTheDocument()
    expect(screen.getByTitle('Nam (ghi tự do cũ)')).toBeInTheDocument()
    await chooseIn('Thợ chính', 'Nguyễn Văn B')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(setCellEventEffort).toHaveBeenCalledWith(2, expect.objectContaining({
      leadName: 'Tổ 1', painterName: 'Nguyễn Văn B',
    })))
  })

  it('reports a refused backfill and keeps the dialog open', async () => {
    setCellEventEffort.mockRejectedValue(new Error('set_cell_event_effort: admin only'))
    renderPanel()
    expect(await screen.findByText('R1C2')).toBeInTheDocument()
    await userEvent.click(within(rows()[1]).getByRole('button', { name: 'Sửa' }))
    await userEvent.type(await screen.findByLabelText('Số giờ công (Mhr)'), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByText('set_cell_event_effort: admin only')).toBeInTheDocument()
    expect(screen.getByText('Giờ công · Ô R1C1 · Lớp 1')).toBeInTheDocument()
  })

  it('says so when the history cannot be loaded, and asks the screen to retry', async () => {
    renderPanel(true, { events: null, error: 'mất kết nối' })
    expect(await screen.findByText('Không tải được lịch sử cập nhật')).toBeInTheDocument()
    expect(screen.getByText('mất kết nối')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('EffortHistoryPanel — the waste reason is a note (UI-04 amended, UI-03)', () => {
  it('prints the reason as plain text in a left-aligned column, not as a badge', async () => {
    renderPanel()
    const reason = await screen.findByText('Chờ vật tư')
    // The text sits in the cell itself: no pill wrapped around it.
    expect(reason.tagName).toBe('TD')
    expectLeft(reason)
    expectLeft(screen.getByRole('columnheader', { name: 'Lý do hao phí' }))
  })
})

describe('EffortHistoryPanel — identifiers are text (UI-06)', () => {
  it('keeps the bay code and the production order left, the hours centred', async () => {
    renderPanel()
    const order = await screen.findByText('LSX-1')
    const th = (label: string) => screen.getByRole('columnheader', { name: label })
    expectLeft(th('Mã ô'))
    expectLeft(th('Lệnh sản xuất'))
    expectLeft(order.closest('td'))
    expectLeft(screen.getByText('R1C2').closest('td'))
    expect(th('Giờ công')).toHaveStyle({ textAlign: 'center' })
  })

  it('draws no Thao tác column in view mode, and still says which update was edited (R3)', async () => {
    renderPanel(false)
    await screen.findByText('LSX-1')
    expect(screen.queryByRole('columnheader', { name: 'Thao tác' })).toBeNull()
    const [first] = rows()
    const edited = within(first).getByText('đã sửa')
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(edited.closest('td')).toBe(first.querySelectorAll('td')[headers.indexOf('Giờ công')])
  })

  it('titles its action column Thao tác (M20)', async () => {
    renderPanel()
    await screen.findByText('LSX-1')
    expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toHaveClass('ant-table-cell-fix-right')
  })

  it('scrolls sideways rather than squeezing a name to one word per line (I3, MOB-01)', async () => {
    renderPanel()
    await screen.findByText('LSX-1')
    const th = (label: string) => screen.getByRole('columnheader', { name: label })
    expect(th('Mã ô').closest('table')).toHaveStyle({ width: 'max-content' })
    const colOf = (label: string) => {
      const header = th(label)
      const index = [...(header.parentElement as HTMLElement).children].indexOf(header)
      return header.closest('table')?.querySelectorAll('colgroup col')[index] as HTMLElement
    }
    expect(colOf('Nhóm trưởng')).toHaveStyle({ width: '180px' })
    expect(colOf('Thợ chính')).toHaveStyle({ width: '180px' })
    expect(colOf('Lý do hao phí')).toHaveStyle({ width: '220px' })
  })
})

describe('EffortHistoryPanel — pager scope (UI-06)', () => {
  it('goes back to page 1 when the deck changes under it, with no filter change', async () => {
    // The deck screen keeps this panel mounted from one deck to the next.
    const many = Array.from({ length: 25 }, (_, i) => ev({ id: 100 + i, cellCode: `R${i}C1` }))
    const panel = (deckId: string) => (
      <AntApp>
        <EffortHistoryPanel deckId={deckId} editable events={many} error={null} onRetry={onRetry} onSaved={onSaved} />
      </AntApp>
    )
    const { rerender } = render(panel('d1'))
    await userEvent.click(await screen.findByTitle('2'))
    expect(screen.getByTitle('2')).toHaveClass('ant-pagination-item-active')
    rerender(panel('d2'))
    expect(screen.getByTitle('1')).toHaveClass('ant-pagination-item-active')
  })
})
