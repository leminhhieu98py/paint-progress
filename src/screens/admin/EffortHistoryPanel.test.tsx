import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_EFFORT, type DeckEvent } from '../../domain/types'
import { EffortHistoryPanel } from './EffortHistoryPanel'

const listDeckEvents = vi.hoisted(() => vi.fn())
const setCellEventEffort = vi.hoisted(() => vi.fn())
const listGsUsers = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  listDeckEvents: (id: string) => listDeckEvents(id),
  setCellEventEffort: (id: number, effort: unknown) => setCellEventEffort(id, effort),
}))
vi.mock('../../lib/adminApi', () => ({
  listGsUsers: (includeHidden: boolean) => listGsUsers(includeHidden),
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
    effort: { leadName: 'Tổ 1', painterName: 'Nam', workHours: 3.5, wasteHours: 0.5, wasteReason: 'Chờ vật tư' },
    effortEditedAt: '2026-09-05T02:00:00Z', effortEditedByName: 'Đoàn Công Linh',
  }),
]

const renderPanel = (editable = true) =>
  render(
    <AntApp>
      <EffortHistoryPanel deckId="d1" editable={editable} />
    </AntApp>,
  )

const rows = () => screen.getAllByRole('row').slice(1)

beforeEach(() => {
  listDeckEvents.mockReset()
  setCellEventEffort.mockReset()
  listGsUsers.mockReset()
  listDeckEvents.mockResolvedValue(EVENTS)
  listGsUsers.mockResolvedValue([
    { id: 'u1', fullName: 'Lê Văn A' }, { id: 'u2', fullName: 'Trần Thị B' },
  ])
})

describe('EffortHistoryPanel', () => {
  it('lists every update newest first, with the author, the crew and the hours', async () => {
    renderPanel()
    expect(await screen.findByText('R1C2')).toBeInTheDocument()
    expect(listDeckEvents).toHaveBeenCalledWith('d1')
    // Hidden accounts too: a bay ticked by someone since hidden is still theirs.
    expect(listGsUsers).toHaveBeenCalledWith(true)

    const [first, second] = rows()
    expect(within(first).getByText('R1C2')).toBeInTheDocument()
    expect(within(first).getByText('Trần Thị B')).toBeInTheDocument()
    expect(within(first).getByText('Tổ 1')).toBeInTheDocument()
    expect(within(first).getByText('Nam')).toBeInTheDocument()
    expect(within(first).getByText('3,5')).toBeInTheDocument()
    expect(within(first).getByText('0,5')).toBeInTheDocument()
    expect(within(first).getByText('Chờ vật tư')).toBeInTheDocument()
    expect(within(first).getByText('đã sửa')).toBeInTheDocument()
    expect(within(second).getByText('R1C1')).toBeInTheDocument()
    expect(within(second).getByText('Lê Văn A')).toBeInTheDocument()
    expect(within(second).queryByText('đã sửa')).toBeNull()

    expect(screen.getByText('1 / 2 lần cập nhật có giờ công')).toBeInTheDocument()
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
    await userEvent.type(screen.getByLabelText('Nhóm trưởng'), 'Tổ 2')
    await userEvent.type(screen.getByLabelText('Số giờ công (Mhr)'), '4')
    // A reason is asked for only once hours were lost.
    expect(screen.queryByLabelText('Lý do hao phí')).toBeNull()
    await userEvent.type(screen.getByLabelText('Giờ hao phí (Mhr)'), '1')
    await userEvent.type(await screen.findByLabelText('Lý do hao phí'), 'Mưa')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(setCellEventEffort).toHaveBeenCalledWith(1, {
      leadName: 'Tổ 2', painterName: '', workHours: 4, wasteHours: 1, wasteReason: 'Mưa',
    }))
    expect(await screen.findByText('Đã lưu giờ công')).toBeInTheDocument()
    await waitFor(() => expect(listDeckEvents).toHaveBeenCalledTimes(2))
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

  it('says so when the history cannot be loaded, and offers a retry', async () => {
    listDeckEvents.mockRejectedValueOnce(new Error('mất kết nối'))
    renderPanel()
    expect(await screen.findByText('Không tải được lịch sử cập nhật')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('R1C2')).toBeInTheDocument()
  })
})
