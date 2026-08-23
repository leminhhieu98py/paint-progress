import { App as AntApp } from 'antd'
import {
  act, render, screen, waitFor, within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GsScreen } from './GsScreen'

const loadGsProject = vi.hoisted(() => vi.fn())
const listDeckCells = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const setCellStage = vi.hoisted(() => vi.fn())
const subscribeDeckCells = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())

vi.mock('../../lib/gsApi', () => ({
  loadGsProject: (projectId: string) => loadGsProject(projectId),
  listDeckCells: (deckId: string) => listDeckCells(deckId),
  listDeckZones: (deckId: string) => listDeckZones(deckId),
  setCellStage: (cellId: string, stageId: string | null) => setCellStage(cellId, stageId),
  subscribeDeckCells: (
    deckId: string,
    handlers: { onCellChange: (cell: unknown) => void; onStatus: (status: string) => void },
  ) => subscribeDeckCells(deckId, handlers),
}))
vi.mock('../../lib/decksApi', () => ({
  getDrawingUrl: (path: string) => getDrawingUrl(path),
}))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'u1', username: 'gs1', fullName: 'Nguyễn Văn A', role: 'gs', active: true },
    signOut,
  }),
}))
// One button per cell, exposing the colour the screen assigned it. Konva renders
// to a canvas, which jsdom does not implement, so the real component cannot run
// here; what it renders for real was established by driving it in Chrome.
vi.mock('../../canvas/DrawingCanvas', () => ({
  DrawingCanvas: ({
    imageUrl, cells, cellColors, planLabels, panZoom, onCellClick,
  }: {
    imageUrl: string
    cells: { code: string }[]
    cellColors?: Record<string, string>
    planLabels?: Record<string, string>
    panZoom?: boolean
    onCellClick?: (code: string, additive: boolean) => void
  }) => (
    <div data-testid="canvas" data-image={imageUrl} data-panzoom={String(Boolean(panZoom))}>
      {cells.map((c) => (
        <button
          key={c.code}
          data-color={cellColors?.[c.code] ?? ''}
          data-plan={planLabels?.[c.code] ?? ''}
          onClick={() => onCellClick?.(c.code, false)}
        >
          ô {c.code}
        </button>
      ))}
    </div>
  ),
}))

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
  { id: 's4', seq: 4, name: 'Coat 4', color: '#1677ff', weight: 0.15 },
  { id: 's5', seq: 5, name: 'Tháo giáo', color: '#722ed1', weight: 0.1 },
]

const DECKS = [
  {
    id: 'd1', seq: 1, name: 'Cellar Deck', code: 'CD',
    imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
    totalAreaM2: 1000, areaSource: 'guides' as const,
  },
  {
    id: 'd2', seq: 2, name: 'Main Deck', code: 'MD',
    imagePath: 'p1/d2.png', imageW: 2000, imageH: 1600,
    totalAreaM2: 500, areaSource: 'guides' as const,
  },
]

const D1_CELLS = [
  { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 0.5, areaM2: 300, stageId: 's1' },
  { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 0.5, areaM2: 200, stageId: 's2' },
  { id: 'c3', code: 'R2C1', x: 0, y: 0.5, w: 0.5, h: 0.5, areaM2: 100, stageId: null },
]

const D2_CELLS = [
  { id: 'c9', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 500, stageId: 's5' },
]

// Wrapped in antd's App because src/App.tsx wraps the whole tree in it, and
// because App.useApp()'s `message` is how the screen reports a failed write:
// outside an <App> provider antd falls back to a static instance that renders
// outside this tree, and Task 6's rollback assertion would find nothing.
const renderScreen = () =>
  render(
    <AntApp>
      <MemoryRouter initialEntries={['/gs/p1']}>
        <Routes>
          <Route path="/gs/:projectId" element={<GsScreen />} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  )

/**
 * Captures the handlers the screen registers, and models the two constraints of
 * the real subscription that the screen's correctness depends on: exactly one
 * live subscription at a time (the returned function must be called before a
 * new one is opened), and status callbacks that arrive as the two states gsApi
 * maps to, never as a boolean.
 */
let liveHandlers: {
  onCellChange: (cell: unknown) => void
  onStatus: (status: string) => void
} | null = null
const subscribedDecks: string[] = []
const unsubscribe = vi.fn()

beforeEach(() => {
  loadGsProject.mockReset()
  listDeckCells.mockReset()
  listDeckZones.mockReset()
  listDeckZones.mockResolvedValue([])
  setCellStage.mockReset()
  getDrawingUrl.mockReset()
  signOut.mockReset()
  subscribeDeckCells.mockReset()
  unsubscribe.mockReset()
  subscribedDecks.length = 0
  liveHandlers = null
  subscribeDeckCells.mockImplementation((deckId: string, handlers: typeof liveHandlers) => {
    subscribedDecks.push(deckId)
    liveHandlers = handlers
    return unsubscribe
  })
  setCellStage.mockResolvedValue(undefined)
  loadGsProject.mockResolvedValue({ stages: STAGES, decks: DECKS })
  listDeckCells.mockImplementation((deckId: string) =>
    Promise.resolve(deckId === 'd1' ? D1_CELLS : D2_CELLS))
  getDrawingUrl.mockImplementation((path: string) => Promise.resolve(`https://signed/${path}`))
})

describe('GsScreen', () => {
  it('loads the project named in the route', async () => {
    renderScreen()
    await waitFor(() => expect(loadGsProject).toHaveBeenCalledWith('p1'))
  })

  it('shows one tab per deck and opens the first one', async () => {
    renderScreen()

    expect(await screen.findByRole('tab', { name: 'Cellar Deck' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Main Deck' })).toBeInTheDocument()
    // The first deck's cells, not the second's: c3 exists only on d1.
    await waitFor(() => expect(screen.getByRole('button', { name: 'ô R2C1' })).toBeInTheDocument())
  })

  it('loads the selected deck\'s cells and drawing when the tab changes', async () => {
    renderScreen()
    await screen.findByRole('tab', { name: 'Main Deck' })

    await userEvent.click(screen.getByRole('tab', { name: 'Main Deck' }))

    await waitFor(() => expect(listDeckCells).toHaveBeenCalledWith('d2'))
    // The drawing has to change with the tab. Asserting the URL, not just that
    // getDrawingUrl was called: a screen that fetched the new deck's cells and
    // kept the old deck's image would put the right colours on the wrong plan.
    await waitFor(() =>
      expect(screen.getByTestId('canvas')).toHaveAttribute('data-image', 'https://signed/p1/d2.png'))
    expect(getDrawingUrl).toHaveBeenCalledWith('p1/d2.png')
  })

  it('drops a slow answer for the deck the foreman has already left', async () => {
    // Task 9 moved this fetch out of the effect and into a shared callback, so
    // the effect's own `cancelled` closure is gone and the guard is now a ref on
    // the wanted deck id. Same defect either way: the Cellar Deck's cells land
    // on the Main Deck's drawing, colouring bays that are not there and being
    // divided by the wrong deck's 500 m².
    let resolveD1: (cells: typeof D1_CELLS) => void = () => {}
    listDeckCells.mockImplementation((deckId: string) =>
      deckId === 'd1'
        ? new Promise((res) => { resolveD1 = res })
        : Promise.resolve(D2_CELLS))

    renderScreen()
    await userEvent.click(await screen.findByRole('tab', { name: 'Main Deck' }))
    await waitFor(() => expect(listDeckCells).toHaveBeenCalledWith('d2'))

    resolveD1(D1_CELLS)

    // d2 has one cell, R1C1 at Tháo giáo. R2C1 exists only on d1.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '#722ed1'))
    expect(screen.queryByRole('button', { name: 'ô R2C1' })).toBeNull()
  })

  it('colours each cell with its current stage colour', async () => {
    renderScreen()

    const cell1 = await screen.findByRole('button', { name: 'ô R1C1' })
    expect(cell1).toHaveAttribute('data-color', '#fadb14')
    expect(screen.getByRole('button', { name: 'ô R1C2' })).toHaveAttribute('data-color', '#bfbfbf')
    // A cell that has not started must carry NO colour -- an unfilled cell is
    // how a foreman sees what is left to do.
    expect(screen.getByRole('button', { name: 'ô R2C1' })).toHaveAttribute('data-color', '')
  })

  it('gives the foreman pan and zoom', async () => {
    renderScreen()
    // Spec §8.1 requires it, and the drawing is larger than the tablet.
    await waitFor(() =>
      expect(screen.getByTestId('canvas')).toHaveAttribute('data-panzoom', 'true'))
  })

  it('reports the deck\'s progress from the deck\'s own declared area', async () => {
    renderScreen()
    // A_1 = 300 + 200 = 500, A_2 = 200, rest 0; p = 0.5, 0.2, 0, 0, 0.
    // prog = 0.25*0.5 + 0.15*0.2 = 0.155. Divided by the deck's 1000 m², NOT by
    // the 600 m² its cells cover -- that is the whole of spec §3.2's
    // denominator rule, and the number the customer is billed against.
    expect(await screen.findByText('15,50%')).toBeInTheDocument()
  })

  it('shows the deck\'s declared area in the bottom strip', async () => {
    renderScreen()
    const strip = await screen.findByTestId('gs-spec-region')
    expect(strip).toHaveTextContent('1.000,00')
  })

  it('sticks the bottom strip to the viewport', async () => {
    renderScreen()
    expect(await screen.findByTestId('gs-spec-region')).toHaveStyle({ position: 'sticky' })
  })

  it('lays the two regions out at roughly 60/40 on a tablet and stacks them below it', async () => {
    renderScreen()
    await screen.findByTestId('canvas')
    // 14/24 and 10/24 of an antd Row = 58.3% / 41.7%. xs=24 stacks them on a
    // phone; spec §13 excludes a phone design but must not produce two
    // unreadable half-width columns on one.
    expect(document.querySelector('.ant-col-md-14')).not.toBeNull()
    expect(document.querySelector('.ant-col-md-10')).not.toBeNull()
    expect(document.querySelectorAll('.ant-col-xs-24')).toHaveLength(2)
  })

  it('offers logout and nothing else about the account', async () => {
    renderScreen()

    await userEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }))

    expect(signOut).toHaveBeenCalledTimes(1)
    // Spec §8.1: "No account UI. Logout only." GS accounts have no
    // self-service by design (spec §2), so any of these would be a dead end.
    expect(screen.queryByRole('button', { name: /đổi mật khẩu/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /tài khoản/i })).toBeNull()
  })

  it('explains a failed project load instead of rendering an empty screen', async () => {
    loadGsProject.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    expect(await screen.findByText('Không tải được dữ liệu dự án')).toBeInTheDocument()
  })

  it('explains a failed drawing load but still shows the numbers', async () => {
    // The signed URL is a separate round trip against Storage and fails
    // separately -- a tether drop mid-load, or an expired signature. The
    // percentages come from the database and are still correct, so losing the
    // picture must not blank the screen.
    getDrawingUrl.mockRejectedValue(new Error('object not found'))
    renderScreen()
    expect(await screen.findByText('Không tải được bản vẽ')).toBeInTheDocument()
    expect(screen.getByText('15,50%')).toBeInTheDocument()
  })

  it('tells a foreman when a deck has no drawing yet', async () => {
    loadGsProject.mockResolvedValue({
      stages: STAGES,
      decks: [{ ...DECKS[0], imagePath: null, imageW: null, imageH: null }],
    })
    renderScreen()
    expect(await screen.findByText('Sàn này chưa có bản vẽ')).toBeInTheDocument()
    expect(getDrawingUrl).not.toHaveBeenCalled()
  })
})

describe('GsScreen: recording a stage', () => {
  /** A promise whose settlement the test controls, so the window between the
   *  optimistic update and the server's answer can be inspected. */
  function deferred() {
    let resolve: () => void = () => {}
    let reject: (e: Error) => void = () => {}
    const promise = new Promise<void>((res, rej) => {
      resolve = () => res()
      reject = rej
    })
    return { promise, resolve, reject }
  }

  const tapCellAndChoose = async (cellCode: string, stageLabel: string) => {
    await userEvent.click(await screen.findByRole('button', { name: `ô ${cellCode}` }))
    // getByRole, not getByLabelText: antd puts the aria-label on both the
    // wrapper and the inner input, so getByLabelText finds two elements.
    await userEvent.click(await screen.findByRole('combobox', { name: 'Công đoạn' }))
    await userEvent.click(await screen.findByTitle(stageLabel))
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
  }

  it('opens the modal for the tapped cell', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'ô R1C2' }))

    expect(await screen.findByText('Ô R1C2')).toBeInTheDocument()
    // Its own area and its own current stage, not the first cell's. Scoped to
    // the modal's info rows: Task 7's pie legend also shows "200,00 m²" for the
    // Coat 2 slice, which happens to hold exactly this one cell -- an unscoped
    // query would find both.
    expect(
      within(screen.getByTestId('cell-stage-info')).getByText('200,00 m²'),
    ).toBeInTheDocument()
  })

  it('writes only the cell\'s stage id', async () => {
    renderScreen()
    await tapCellAndChoose('R2C1', 'Coat 3')

    expect(setCellStage).toHaveBeenCalledWith('c3', 's3')
  })

  it('moves the reported progress before the write comes back', async () => {
    const pending = deferred()
    setCellStage.mockReturnValue(pending.promise)

    renderScreen()
    expect(await screen.findByText('15,50%')).toBeInTheDocument()

    await tapCellAndChoose('R2C1', 'Tháo giáo')

    // R2C1 is 100 m² of a 1000 m² deck, moving from not started to the last
    // stage: every A_i gains 100, so prog goes to
    // p = 0.6, 0.3, 0.1, 0.1, 0.1, so
    // 0.25*0.6 + 0.15*0.3 + 0.35*0.1 + 0.15*0.1 + 0.10*0.1
    //   = 0.15 + 0.045 + 0.035 + 0.015 + 0.01 = 0.255.
    // Asserted while `pending` is STILL UNRESOLVED -- that is the whole test.
    // An implementation that awaits the write before setState shows 15,50%
    // here and 25,50% only later, and no assertion on the final state can
    // tell the two apart.
    expect(await screen.findByText('25,50%')).toBeInTheDocument()

    pending.resolve()
    await waitFor(() => expect(screen.getByText('25,50%')).toBeInTheDocument())
  })

  it('rolls the cell back and says so when the write fails', async () => {
    const pending = deferred()
    setCellStage.mockReturnValue(pending.promise)

    renderScreen()
    await tapCellAndChoose('R2C1', 'Tháo giáo')
    expect(await screen.findByText('25,50%')).toBeInTheDocument()

    // Injected AT THE WRITE, and nowhere else: an error thrown from the mocked
    // listDeckCells or from the canvas would exercise a different path and
    // prove nothing about this one.
    pending.reject(new Error('Failed to fetch'))

    expect(await screen.findByText('15,50%')).toBeInTheDocument()
    expect(
      await screen.findByText('Không lưu được tiến độ. Kiểm tra kết nối rồi thử lại.'),
    ).toBeInTheDocument()
    // And the cell's colour goes back with it -- the canvas is what the foreman
    // is actually looking at.
    expect(screen.getByRole('button', { name: 'ô R2C1' })).toHaveAttribute('data-color', '')
  })

  it('leaves the other cells alone when it rolls back', async () => {
    const pending = deferred()
    setCellStage.mockReturnValue(pending.promise)

    renderScreen()
    await tapCellAndChoose('R2C1', 'Tháo giáo')
    pending.reject(new Error('Failed to fetch'))

    // Nothing else was touched, so the untouched cells must be untouched. Note
    // that this passes for a snapshot rollback too -- see the next test, which
    // is the one that can tell them apart.
    expect(await screen.findByText('15,50%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '#fadb14')
    expect(screen.getByRole('button', { name: 'ô R1C2' })).toHaveAttribute('data-color', '#bfbfbf')
  })

  it('keeps a second cell\'s write when the first one rolls back', async () => {
    // THE test for "restore one cell by id, not a snapshot of the array": two
    // writes overlap, and the first one fails. A rollback that restored the
    // snapshot it took before R1C1 was recorded would silently un-record it --
    // and every other assertion in this file passes while it does. With realtime
    // wired up (Task 9) the discarded write is another foreman's, arriving over
    // the socket rather than from this tablet, and nothing on screen says it went.
    const failing = deferred()
    const stillInFlight = deferred()
    setCellStage.mockImplementation((cellId: string) =>
      cellId === 'c3' ? failing.promise : stillInFlight.promise)

    renderScreen()
    await tapCellAndChoose('R2C1', 'Tháo giáo')
    await tapCellAndChoose('R1C1', 'Coat 4')
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '#1677ff')

    failing.reject(new Error('Failed to fetch'))

    // R2C1 goes back, because its own write failed...
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ô R2C1' })).toHaveAttribute('data-color', ''))
    // ...and R1C1 keeps the coat it was given while that write was in flight.
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '#1677ff')
    // R1C1 at s4, R1C2 at s2, R2C1 rolled back to not started: A = 500, 500,
    // 300, 300, 0, so prog = 0.125 + 0.075 + 0.105 + 0.045 = 0.35. The headline
    // number keeps the surviving write too, not just the canvas; a snapshot
    // rollback reads 15,50% here, the value from before either write.
    expect(screen.getByText('35,00%')).toBeInTheDocument()
  })

  it('advances the tapped cell one stage in a single tap', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'ô R1C1' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Xong công đoạn tiếp theo: Coat 2' }),
    )

    // R1C1 sits at s1, so one tap writes s2 -- one stage on from the cell's own
    // current stage, with no dropdown in between and nothing else in the payload.
    expect(setCellStage).toHaveBeenCalledWith('c1', 's2')
    expect(setCellStage).toHaveBeenCalledTimes(1)
    // And the colour moves with it, straight away.
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '#bfbfbf')
  })
})

describe('GsScreen: realtime', () => {
  it('subscribes to the deck on screen', async () => {
    renderScreen()
    await waitFor(() => expect(subscribedDecks).toEqual(['d1']))
  })

  it('closes the old subscription before opening the new one on a tab change', async () => {
    renderScreen()
    await screen.findByRole('tab', { name: 'Main Deck' })
    await userEvent.click(screen.getByRole('tab', { name: 'Main Deck' }))

    await waitFor(() => expect(subscribedDecks).toEqual(['d1', 'd2']))
    // Without this every visited tab leaves a live socket subscription behind,
    // and the Cellar Deck's cells keep arriving into the Main Deck's state.
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('folds another client\'s write into the drawing and the numbers', async () => {
    renderScreen()
    expect(await screen.findByText('15,50%')).toBeInTheDocument()

    act(() => {
      liveHandlers?.onCellChange({
        id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 0.5, areaM2: 300, stageId: 's3',
      })
    })

    // R1C1 moves from Blast + Coat 1 to Coat 3: A_1 = 500, A_2 = 500, A_3 = 300,
    // so prog = 0.25*0.5 + 0.15*0.5 + 0.35*0.3 = 0.305.
    expect(await screen.findByText('30,50%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '#52c41a')
  })

  it('adds a cell it has never seen', async () => {
    renderScreen()
    await screen.findByRole('button', { name: 'ô R1C1' })

    act(() => {
      liveHandlers?.onCellChange({
        id: 'c4', code: 'R2C2', x: 0.5, y: 0.5, w: 0.5, h: 0.5, areaM2: 50, stageId: 's1',
      })
    })

    // The admin can add cells to a deck a foreman is looking at. Merging only
    // known ids would drop it silently -- the foreman would tap a bay that is
    // not on their screen.
    expect(await screen.findByRole('button', { name: 'ô R2C2' })).toBeInTheDocument()
  })

  it('shows a banner while the connection is down', async () => {
    renderScreen()
    await screen.findByRole('button', { name: 'ô R1C1' })
    expect(screen.queryByText('Mất kết nối, đang kết nối lại...')).toBeNull()

    act(() => { liveHandlers?.onStatus('disconnected') })

    expect(await screen.findByText('Mất kết nối, đang kết nối lại...')).toBeInTheDocument()
  })

  it('re-reads the deck shortly after subscribing, to cover the registration lag', async () => {
    // Probed against the live project: a write issued immediately after
    // SUBSCRIBED is not delivered, while the same write four seconds later is.
    // So the gap between the load effect's fetch and the subscription actually
    // being live loses another foreman's tap outright, and nothing on screen
    // would say so. One re-read after SUBSCRIBED closes it.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderScreen()
      await screen.findByRole('button', { name: 'ô R1C1' })
      const afterLoad = listDeckCells.mock.calls.length

      act(() => { liveHandlers?.onStatus('subscribed') })
      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })

      expect(listDeckCells.mock.calls.length).toBe(afterLoad + 1)
      expect(listDeckCells.mock.calls.at(-1)?.[0]).toBe('d1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('warns when the channel never reaches subscribed at all', async () => {
    // realtimeStatus starts optimistically at 'subscribed', so a socket that
    // neither connects nor errors -- a captive portal, a proxy holding the
    // websocket open -- would otherwise leave the foreman reading numbers that
    // stopped updating, with nothing on screen saying so.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderScreen()
      await screen.findByRole('button', { name: 'ô R1C1' })
      expect(screen.queryByText('Mất kết nối, đang kết nối lại...')).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })

      expect(screen.getByText('Mất kết nối, đang kết nối lại...')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not warn when the channel connects before the watchdog fires', async () => {
    // The other half of the pair: a slow tether must not flash a warning on
    // every deck change, so reaching subscribed has to cancel the watchdog.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderScreen()
      await screen.findByRole('button', { name: 'ô R1C1' })

      act(() => { liveHandlers?.onStatus('subscribed') })
      await act(async () => {
        vi.advanceTimersByTime(30_000)
      })

      expect(screen.queryByText('Mất kết nối, đang kết nối lại...')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refetches the deck\'s cells on reconnect, and only then', async () => {
    renderScreen()
    await waitFor(() => expect(listDeckCells).toHaveBeenCalledTimes(1))

    // The initial SUBSCRIBED must NOT refetch: the load effect has just done it,
    // and a second read on every mount doubles the round trips on a tether.
    act(() => { liveHandlers?.onStatus('subscribed') })
    expect(listDeckCells).toHaveBeenCalledTimes(1)

    act(() => { liveHandlers?.onStatus('disconnected') })
    act(() => { liveHandlers?.onStatus('subscribed') })

    // A socket that was down may have missed any number of writes, so the only
    // safe recovery is a full re-read of the deck (spec §11 row 2).
    await waitFor(() => expect(listDeckCells).toHaveBeenCalledTimes(2))
    expect(listDeckCells).toHaveBeenLastCalledWith('d1')
    expect(screen.queryByText('Mất kết nối, đang kết nối lại...')).toBeNull()
  })

  it('keeps another client\'s write when its own write is rolled back', async () => {
    let reject: (e: Error) => void = () => {}
    setCellStage.mockReturnValue(new Promise<void>((_res, rej) => { reject = rej }))

    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'ô R2C1' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Công đoạn' }))
    await userEvent.click(await screen.findByTitle('Tháo giáo'))
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    // Another foreman's tick lands while this write is still in flight.
    act(() => {
      liveHandlers?.onCellChange({
        id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 0.5, areaM2: 300, stageId: 's3',
      })
    })

    reject(new Error('Failed to fetch'))

    // The rollback must undo ONE cell. A snapshot-based rollback restores the
    // array as it was before this write and silently discards R1C1's realtime
    // update -- which is a lost write, reported to nobody, and the reason the
    // rollback is written by id.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ô R2C1' })).toHaveAttribute('data-color', ''))
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '#52c41a')
  })
})

describe('GsScreen: the plan overlay', () => {
  it('fetches no zones while the toggle is off', async () => {
    renderScreen()
    await screen.findByRole('button', { name: 'ô R1C1' })
    // Zero zones exist until Phase 4, so this round trip would buy nothing on
    // a site tether -- and it must not be made per deck tab either.
    expect(listDeckZones).not.toHaveBeenCalled()
  })

  it('draws the planned date range on the zone\'s cells when switched on', async () => {
    listDeckZones.mockResolvedValue([{
      id: 'z1', name: 'Zone 1', stageId: 's5',
      startDate: '2026-08-13', finishDate: '2026-08-19',
      cellIds: ['c1'],
    }])

    renderScreen()
    await userEvent.click(await screen.findByRole('switch'))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledWith('d1'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ô R1C1' }))
        .toHaveAttribute('data-plan', '13/08 – 19/08'))
    // Only the zone's own cells: a deck with one zone must not read as fully
    // planned.
    expect(screen.getByRole('button', { name: 'ô R1C2' })).toHaveAttribute('data-plan', '')
  })

  it('shows nothing when the deck has no zones yet', async () => {
    // The state this ships in. It must be a quiet no-op, not an error or an
    // empty dashed outline on every cell.
    renderScreen()
    await userEvent.click(await screen.findByRole('switch'))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledWith('d1'))
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-plan', '')
  })

  it('clears the overlay when switched off again', async () => {
    listDeckZones.mockResolvedValue([{
      id: 'z1', name: 'Zone 1', stageId: 's5',
      startDate: '2026-08-13', finishDate: '2026-08-19',
      cellIds: ['c1'],
    }])

    renderScreen()
    await userEvent.click(await screen.findByRole('switch'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ô R1C1' }))
        .toHaveAttribute('data-plan', '13/08 – 19/08'))

    await userEvent.click(screen.getByRole('switch'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-plan', ''))
  })
})
