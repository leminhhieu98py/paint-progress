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
const listProjectStageIndex = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const setCellStage = vi.hoisted(() => vi.fn())
const subscribeDeckCells = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
const listStages = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())

vi.mock('../../lib/gsApi', () => ({
  loadGsProject: (projectId: string) => loadGsProject(projectId),
  listDeckCells: (deckId: string) => listDeckCells(deckId),
  listProjectStageIndex: (ids: string[]) => listProjectStageIndex(ids),
  setCellStage: (cellId: string, stageId: string | null) => setCellStage(cellId, stageId),
  subscribeDeckCells: (deckId: string, handlers: Handlers) =>
    subscribeDeckCells(deckId, handlers),
}))
vi.mock('../../lib/zonesApi', () => ({
  listDeckZones: (deckId: string) => listDeckZones(deckId),
}))
vi.mock('../../lib/decksApi', () => ({
  getDrawingUrl: (path: string) => getDrawingUrl(path),
  listStages: (deckId: string) => listStages(deckId),
}))
// react-router's navigate, so the test can see WHERE signing out sends the
// foreman -- not merely that signOut was called.
const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigate,
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

interface Handlers {
  onCellChange: (cell: unknown) => void
  onCellDelete: (cellId: string) => void
  onStatus: (status: string) => void
}

/**
 * Captures the handlers the screen registers, and models the constraints of the
 * real subscription that the screen's correctness depends on:
 *
 * - exactly one live subscription at a time (the returned function must be
 *   called before a new one is opened);
 * - status callbacks that arrive as the two states gsApi maps to, never as a
 *   boolean;
 * - leaving a channel calls that channel's OWN status callback with the
 *   disconnected state, after the caller has already torn down. See the teardown
 *   comment below -- this used to be a bare `vi.fn()`, which is the whole reason
 *   no test in this repo could see the defect it now reproduces.
 */
let liveHandlers: Handlers | null = null
/**
 * Every handler set registered so far, newest last, so a test can address a
 * subscription the screen has already left.
 */
const allHandlers: Handlers[] = []
const subscribedDecks: string[] = []
const unsubscribe = vi.fn()

beforeEach(() => {
  loadGsProject.mockReset()
  listDeckCells.mockReset()
  listProjectStageIndex.mockReset()
  listProjectStageIndex.mockResolvedValue({})
  listDeckZones.mockReset()
  listDeckZones.mockResolvedValue([])
  setCellStage.mockReset()
  getDrawingUrl.mockReset()
  listStages.mockReset()
  // Both decks in the fixture declare the same coat system. Per-deck stage
  // lists are covered by their own test below.
  listStages.mockResolvedValue(STAGES)
  signOut.mockReset()
  signOut.mockResolvedValue(undefined)
  navigate.mockReset()
  subscribeDeckCells.mockReset()
  unsubscribe.mockReset()
  subscribedDecks.length = 0
  allHandlers.length = 0
  liveHandlers = null
  subscribeDeckCells.mockImplementation((deckId: string, handlers: Handlers) => {
    subscribedDecks.push(deckId)
    allHandlers.push(handlers)
    liveHandlers = handlers
    return () => {
      unsubscribe(deckId)
      // What the real client does, and it is not incidental: RealtimeChannel's
      // `unsubscribe` does not remove the `_onClose` hook `subscribe` registered
      // (RealtimeChannel.js:159), so leaving a channel drives that channel's own
      // status callback with CLOSED -- which gsApi maps to 'disconnected' --
      // AFTER the effect that owns it has finished cleaning up. Fired on
      // `handlers`, not on `liveHandlers`, because the point is that it reaches
      // the OLD subscription's handlers and not the new one's.
      handlers.onStatus('disconnected')
    }
  })
  setCellStage.mockResolvedValue(undefined)
  loadGsProject.mockResolvedValue({ decks: DECKS, isMember: true })
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

    expect(await screen.findByRole('tab', { name: /^Cellar Deck/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: new RegExp(`^Main Deck`) })).toBeInTheDocument()
    // The first deck's cells, not the second's: c3 exists only on d1.
    await waitFor(() => expect(screen.getByRole('button', { name: 'ô R2C1' })).toBeInTheDocument())
  })

  it('loads the selected deck\'s cells and drawing when the tab changes', async () => {
    renderScreen()
    await screen.findByRole('tab', { name: new RegExp(`^Main Deck`) })

    await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^Main Deck`) }))

    await waitFor(() => expect(listDeckCells).toHaveBeenCalledWith('d2'))
    // The drawing has to change with the tab. Asserting the URL, not just that
    // getDrawingUrl was called: a screen that fetched the new deck's cells and
    // kept the old deck's image would put the right colours on the wrong plan.
    await waitFor(() =>
      expect(screen.getByTestId('canvas')).toHaveAttribute('data-image', 'https://signed/p1/d2.png'))
    expect(getDrawingUrl).toHaveBeenCalledWith('p1/d2.png')
  })

  it('reads each deck\'s own paint stages, not one list for the project', async () => {
    // The point of moving stages onto the deck: a cellar deck and a main deck on
    // one platform carry different coat systems. A project-wide list put the
    // wrong legend, the wrong colours and the wrong weights on whichever deck
    // did not match it -- and the percentage those weights produce is what the
    // money is paid against.
    listStages.mockImplementation((deckId: string) =>
      Promise.resolve(deckId === 'd1'
        ? STAGES
        : [{ id: 'm1', seq: 1, name: 'Sơn sàn chính', color: '#eb2f96', weight: 1 }]))

    renderScreen()
    // findAllByText: a stage name appears both in the legend and in the spec
    // table, so the singular query is ambiguous here rather than absent.
    expect(await screen.findAllByText('Blast + Coat 1')).not.toHaveLength(0)

    await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^Main Deck`) }))

    expect(await screen.findAllByText('Sơn sàn chính')).not.toHaveLength(0)
    expect(screen.queryAllByText('Blast + Coat 1')).toHaveLength(0)
    expect(listStages).toHaveBeenCalledWith('d2')
  })

  it('says so when a deck\'s stages cannot be read, instead of showing 0%', async () => {
    // An empty stage list is not an error anywhere downstream: every percentage
    // reduces over it and comes out 0%, which reads as "nothing has been
    // painted" -- the same "a refusal must never render as missing data" rule
    // the not-a-member banner exists for.
    listStages.mockRejectedValue(new Error('Failed to fetch'))

    renderScreen()

    expect(await screen.findByText('Không tải được lớp sơn của sàn')).toBeInTheDocument()
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
    await userEvent.click(await screen.findByRole('tab', { name: new RegExp(`^Main Deck`) }))
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

  it('shows the deck\'s declared area beside the figure it is the denominator of', async () => {
    // It used to live in a sticky strip along the bottom, away from the
    // percentage it explains. The two belong in one card: the area is what the
    // percentage is OF, and reading one without the other says nothing.
    renderScreen()
    // Waits on the CONTENT, not the card. The card renders immediately, at
    // 0,00% of 0,00 m², and only fills in once the cells and stages land --
    // so awaiting the container and asserting on its text is a race that
    // passes or fails on how busy the machine is.
    const card = await screen.findByTestId('gs-deck-progress')
    await waitFor(() => expect(card).toHaveTextContent('15,50%'))
    expect(card).toHaveTextContent('1.000,00')
  })

  it('stacks the drawing and the numbers on anything narrower than a laptop', async () => {
    // jsdom reports no width, so antd's breakpoints all read false -- which is
    // the narrow case, and the one that matters: squeezing a rail beside the
    // drawing on a tablet costs the drawing exactly the pixels the foreman taps
    // through a glove.
    renderScreen()
    await screen.findByTestId('canvas')
    const body = screen.getByTestId('canvas').closest('.ant-layout-content') as HTMLElement
    expect(body).toHaveStyle({ gridTemplateColumns: 'minmax(0,1fr)' })
  })

  it('scores each tab against its own deck\'s coats, not the open deck\'s', async () => {
    // Every deck declares its own stage list with its own ids (spec §3.1).
    // Reading deck 2's bays against deck 1's stages counts every bay as not
    // started, and a deck well along reads 0,00% on the control the foreman
    // picks a deck by -- which is worse than no figure, because he believes it.
    listProjectStageIndex.mockResolvedValue({
      d1: {
        cells: [{ areaM2: 1000, stageId: 'own-1' }],
        stages: [{ id: 'own-1', seq: 1, name: 'Coat 1', color: '#111111', weight: 1 }],
      },
      d2: {
        cells: [{ areaM2: 500, stageId: 'other-1' }],
        stages: [{ id: 'other-1', seq: 1, name: 'Lót', color: '#222222', weight: 1 }],
      },
    })
    renderScreen()

    // d1 is Cellar Deck: 1000 m² declared, 1000 m² of bays at its OWN Coat 1.
    // d2 is Main Deck: 500 m² declared, 500 m² of bays at ITS own Coat 1, whose
    // id shares nothing with d1's. Against one shared stage list one of the two
    // reads 0,00%; against their own, both read 100,00%.
    expect(await screen.findByRole('tab', { name: /^Cellar Deck100,00%/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Main Deck100,00%/ })).toBeInTheDocument()
  })

  it('shows an em dash on a tab whose figure has not arrived', async () => {
    // A wrong figure on the control you are choosing by is worse than none.
    listProjectStageIndex.mockReturnValue(new Promise(() => {}))
    renderScreen()
    expect(await screen.findByRole('tab', { name: /^Cellar Deck—/ })).toBeInTheDocument()
  })

  it('offers logout and nothing else about the account', async () => {
    renderScreen()

    await userEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đăng xuất' }))

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
      decks: [{ ...DECKS[0], imagePath: null, imageW: null, imageH: null }],
      isMember: true,
    })
    renderScreen()
    expect(await screen.findByText('Sàn này chưa có bản vẽ')).toBeInTheDocument()
    expect(getDrawingUrl).not.toHaveBeenCalled()
  })

  it('refuses a project the foreman is not in, instead of showing it empty', async () => {
    // `/gs/:projectId` gates on role alone, so a GS can reach a project they are
    // not assigned to -- a mistyped id, or a link to another platform. RLS then
    // answers every query with zero rows and NO error, so the screen used to
    // render "Sàn này chưa có bản vẽ" over "Tổng diện tích sàn: 0,00 m²":
    // byte-for-byte what a project awaiting its drawings looks like. The foreman
    // would wait for an upload that was never coming. This codebase's rule,
    // adopted after a Phase 1 defect of the same class, is that a refusal must
    // never render as missing data.
    loadGsProject.mockResolvedValue({ decks: [], isMember: false })
    renderScreen()

    expect(await screen.findByText('Không xem được dự án này')).toBeInTheDocument()
    expect(
      screen.getByText(/Liên hệ quản trị viên để được thêm vào dự án/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Sàn này chưa có bản vẽ')).toBeNull()
    // And none of the plausible-empty-deck furniture: no 0,00 m² total, no pie.
    expect(screen.queryByTestId('gs-chart-region')).toBeNull()
  })

  it('still shows the empty-drawing state to a member whose project has no decks', async () => {
    // The negative control, and the reason this needed a membership read rather
    // than "zero decks means refused": a member of a project the admin has not
    // finished setting up must not be sent to ask for access they already have.
    loadGsProject.mockResolvedValue({ decks: [], isMember: true })
    renderScreen()

    expect(await screen.findByText('Sàn này chưa có bản vẽ')).toBeInTheDocument()
    expect(screen.queryByText('Không xem được dự án này')).toBeNull()
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

  it('keeps the deck on screen when a re-read fails', async () => {
    // A re-read failing on a site tether is the common case, not the edge one.
    // Clearing the cells there would take the drawing, the pie and both table
    // rows away from a foreman whose data is still perfectly valid -- and the
    // load effect, not this path, owns the genuine empty state.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderScreen()
      expect(await screen.findByText('15,50%')).toBeInTheDocument()

      listDeckCells.mockRejectedValueOnce(new Error('network'))
      act(() => { liveHandlers?.onStatus('subscribed') })
      await act(async () => {
        vi.advanceTimersByTime(6_000)
      })

      expect(screen.getByText('15,50%')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ô R1C1' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let the post-subscribe re-read undo a write still in flight', async () => {
    // The PATCH and the re-read race, and the re-read can answer first. When it
    // does, the server still reports the PRE-write row, so a whole-array
    // replace puts the old value back on screen -- and no error fires, because
    // the write did not fail. The foreman watches their own tap get undone with
    // nothing explaining it. This is the guard on the fix for that.
    const pending = deferred()
    setCellStage.mockReturnValue(pending.promise)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderScreen()
      expect(await screen.findByText('15,50%')).toBeInTheDocument()

      await tapCellAndChoose('R2C1', 'Tháo giáo')
      expect(await screen.findByText('25,50%')).toBeInTheDocument()

      // The re-read answers with the deck as the server still has it: R2C1 not
      // started. Exactly what the grace re-read fetches mid-write.
      act(() => { liveHandlers?.onStatus('subscribed') })
      await act(async () => {
        vi.advanceTimersByTime(6_000)
      })

      // Still the optimistic value. A plain setCells(next) here shows 15,50%.
      expect(screen.getByText('25,50%')).toBeInTheDocument()

      pending.resolve()
      await waitFor(() => expect(screen.getByText('25,50%')).toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
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

  it('does not put a remembered value back over another foreman\'s newer write', async () => {
    // Two foremen, one bay. This tablet taps Tháo giáo; the other commits Coat 3
    // and it arrives over realtime, so the screen correctly reads 23,00%. Then
    // this tablet's write fails. A rollback to the value remembered at tap time
    // -- "not started" -- leaves the screen contradicting the database with
    // nothing coming to correct it: realtime has already delivered the only
    // notification of that cell it is going to send, and the next full re-read is
    // a reconnect or a deck change away.
    const pending = deferred()
    setCellStage.mockReturnValue(pending.promise)

    renderScreen()
    await tapCellAndChoose('R2C1', 'Tháo giáo')
    expect(await screen.findByText('25,50%')).toBeInTheDocument()

    act(() => {
      liveHandlers?.onCellChange({
        id: 'c3', code: 'R2C1', x: 0, y: 0.5, w: 0.5, h: 0.5, areaM2: 100, stageId: 's3',
      })
    })
    // A_1 = 600, A_2 = 300, A_3 = 100: 0.15 + 0.045 + 0.035 = 0.23.
    expect(await screen.findByText('23,00%')).toBeInTheDocument()

    pending.reject(new Error('Failed to fetch'))

    // The failure is still reported -- this tablet's tap did not land, and the
    // foreman has to know that whatever else is on screen...
    expect(
      await screen.findByText('Không lưu được tiến độ. Kiểm tra kết nối rồi thử lại.'),
    ).toBeInTheDocument()
    // ...but the newer truth stays. A remembered-value rollback reads 15,50%
    // here, with the bay back to uncoloured over a database that holds Coat 3.
    expect(screen.getByText('23,00%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ô R2C1' })).toHaveAttribute('data-color', '#52c41a')
  })

  it('does not let a failed write undo the next tap on the same cell', async () => {
    // One foreman, double tap: Coat 2, then Coat 3 on the same bay before the
    // first write comes back. The first write fails, and its rollback wipes the
    // second tap's optimistic value -- while the second write, which is about to
    // succeed, has already gone out. The screen then disagrees with the database
    // in the direction that under-reports paid work.
    const first = deferred()
    const second = deferred()
    setCellStage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    renderScreen()
    await tapCellAndChoose('R2C1', 'Coat 2')
    await tapCellAndChoose('R2C1', 'Coat 3')
    expect(await screen.findByText('23,00%')).toBeInTheDocument()

    first.reject(new Error('Failed to fetch'))
    await screen.findByText('Không lưu được tiến độ. Kiểm tra kết nối rồi thử lại.')

    // A rollback not gated on this cell's write generation reads 15,50% here.
    expect(screen.getByText('23,00%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ô R2C1' })).toHaveAttribute('data-color', '#52c41a')

    second.resolve()
    await waitFor(() => expect(screen.getByText('23,00%')).toBeInTheDocument())
  })

  it('rolls a double tap back to the last CONFIRMED value, not the first tap\'s', async () => {
    // Both writes fail, so the cell does have to roll back -- to what the server
    // last confirmed, which is "not started". Coat 2 existed only as the first
    // tap's optimistic value on this one screen; landing there would leave the
    // deck reporting progress the database never recorded, permanently, because
    // nothing else on this path ever re-reads that cell.
    const first = deferred()
    const second = deferred()
    setCellStage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    renderScreen()
    await tapCellAndChoose('R2C1', 'Coat 2')
    await tapCellAndChoose('R2C1', 'Coat 3')
    expect(await screen.findByText('23,00%')).toBeInTheDocument()

    first.reject(new Error('Failed to fetch'))
    second.reject(new Error('Failed to fetch'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ô R2C1' })).toHaveAttribute('data-color', ''))
    // 15,50%, the value before either tap -- not 19,50%, which is where a
    // baseline read from render scope at the second tap would leave it.
    expect(screen.getByText('15,50%')).toBeInTheDocument()
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
    await screen.findByRole('tab', { name: new RegExp(`^Main Deck`) })
    await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^Main Deck`) }))

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

  it('drops a cell the admin deleted, and the deck total with it', async () => {
    renderScreen()
    expect(await screen.findByText('15,50%')).toBeInTheDocument()

    act(() => { liveHandlers?.onCellDelete('c2') })

    // R1C2 was 200 m² at Coat 2, so its area has to leave every A_i: A_1 = 300,
    // A_2 = 0, prog = 0.25*0.3 = 0.075. The DENOMINATOR does not move -- the
    // deck still declares 1000 m² whether or not a bay is mapped (spec §3.2).
    expect(await screen.findByText('7,50%')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ô R1C2' })).toBeNull()
  })

  it('keeps a merged-away cell\'s area out of the total', async () => {
    // The reproduced failure this branch exists for. mergeCells returns
    // `code: topLeft.code`, so a merge in the admin's deck editor is ONE update
    // of the survivor to the union area plus a DELETE of each absorbed cell.
    // Subscribed to INSERT and UPDATE only, the survivor grows here while the
    // absorbed cell stays -- its 200 m² counted twice, in every A_i and therefore
    // in the percentage the customer makes schedule and payment decisions from,
    // until the foreman happens to change deck tab.
    renderScreen()
    expect(await screen.findByText('15,50%')).toBeInTheDocument()

    act(() => {
      // R1C1 absorbs R1C2: 300 + 200 = 500 m², keeping the survivor's own stage.
      liveHandlers?.onCellChange({
        id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 0.5, areaM2: 500, stageId: 's1',
      })
      liveHandlers?.onCellDelete('c2')
    })

    // Truth: A_1 = 500 of 1000 and nothing beyond it, so prog = 0.25*0.5.
    expect(await screen.findByText('12,50%')).toBeInTheDocument()
    // Without the delete branch this reads 20,50% -- A_1 = 700, A_2 = 200 -- and
    // on the real 6139 m² Cellar Deck four merged bays are about +3.9 points.
    expect(screen.queryByText('20,50%')).toBeNull()
  })

  it('ignores a delete for a cell it never held', async () => {
    renderScreen()
    expect(await screen.findByText('15,50%')).toBeInTheDocument()

    act(() => { liveHandlers?.onCellDelete('c-not-on-this-deck') })

    // A no-op, not a throw and not a cleared deck. An unknown id is reachable:
    // a row this tablet has already dropped, or one it never read because the
    // deck load and the delete crossed.
    expect(screen.getByText('15,50%')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^ô / })).toHaveLength(3)
  })

  it('shows a banner while the connection is down', async () => {
    renderScreen()
    await screen.findByRole('button', { name: 'ô R1C1' })
    expect(screen.queryByText('Mất kết nối, đang kết nối lại…')).toBeNull()

    act(() => { liveHandlers?.onStatus('disconnected') })

    expect(await screen.findByText('Mất kết nối, đang kết nối lại…')).toBeInTheDocument()
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
        vi.advanceTimersByTime(6_000)
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
      expect(screen.queryByText('Mất kết nối, đang kết nối lại…')).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })

      expect(screen.getByText('Mất kết nối, đang kết nối lại…')).toBeInTheDocument()
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

      expect(screen.queryByText('Mất kết nối, đang kết nối lại…')).toBeNull()
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
    expect(screen.queryByText('Mất kết nối, đang kết nối lại…')).toBeNull()
  })

  it('does not report a disconnect just because a deck tab was left', async () => {
    renderScreen()
    await screen.findByRole('tab', { name: new RegExp(`^Main Deck`) })
    await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^Main Deck`) }))
    await waitFor(() => expect(subscribedDecks).toEqual(['d1', 'd2']))

    const readsOfD2 = () => listDeckCells.mock.calls.filter(([id]) => id === 'd2').length
    expect(readsOfD2()).toBe(1)

    // Leaving d1 drives d1's OWN status callback with CLOSED, after this screen's
    // cleanup has already run. Without the per-effect `disposed` flag the screen
    // takes that as an outage: measured at the tip, one deck tab change produced
    // listDeckCells calls ['d1','d2','d2','d2'] -- three full-deck reads for one
    // deck, on the exact site tether the whole design worries about -- and a
    // "Mất kết nối" banner when nothing was wrong. A banner that appears on every
    // tab change is one a foreman learns to ignore, which is how a real outage
    // gets missed.
    expect(screen.queryByText('Mất kết nối, đang kết nối lại…')).toBeNull()

    // And the new channel connecting must not trigger a recovery re-read either,
    // because there was nothing to recover from.
    act(() => { liveHandlers?.onStatus('subscribed') })
    expect(readsOfD2()).toBe(1)
  })

  it('ignores a payload from a channel it has already left', async () => {
    renderScreen()
    await screen.findByRole('tab', { name: new RegExp(`^Main Deck`) })
    await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^Main Deck`) }))
    await waitFor(() => expect(subscribedDecks).toEqual(['d1', 'd2']))
    // getByTestId, not getByText: the Main Deck's one cell sits at the last
    // stage, so 100,00% is also every legend row and every spec-table cell.
    const headline = () => screen.getByTestId('gs-deck-progress')
    await waitFor(() => expect(headline()).toHaveTextContent('100,00%'))

    const [leftBehind] = allHandlers
    act(() => {
      leftBehind.onCellChange({
        id: 'c4', code: 'R2C2', x: 0.5, y: 0.5, w: 0.5, h: 0.5, areaM2: 50, stageId: 's1',
      })
      leftBehind.onCellDelete('c9')
    })

    // The same defect wantedDeckId guards on the read path: a payload for the
    // Cellar Deck must not land on the Main Deck, colouring a bay that is not
    // there and being divided by the wrong deck's 500 m². The delete half matters
    // as much -- a stale DELETE would take the Main Deck's only cell away.
    expect(screen.queryByRole('button', { name: 'ô R2C2' })).toBeNull()
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toBeInTheDocument()
    expect(headline()).toHaveTextContent('100,00%')
  })

  it('keeps the outage banner across a deck change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderScreen()
      await screen.findByRole('tab', { name: new RegExp(`^Main Deck`) })
      act(() => { liveHandlers?.onStatus('disconnected') })
      expect(await screen.findByText('Mất kết nối, đang kết nối lại…')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^Main Deck`) }))
      await waitFor(() => expect(subscribedDecks).toEqual(['d1', 'd2']))

      // The socket is shared across decks and its health does not change because
      // the foreman looked at another drawing. Resetting the status on teardown
      // hid the banner for the connect watchdog's full ten seconds -- reproduced
      // as shown, tab changed, absent at +9 s, back at +10,5 s -- during which
      // the screen looked healthy while showing whatever the last successful read
      // had left on it.
      expect(screen.getByText('Mất kết nối, đang kết nối lại…')).toBeInTheDocument()
      await act(async () => {
        vi.advanceTimersByTime(9_000)
      })
      expect(screen.getByText('Mất kết nối, đang kết nối lại…')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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

describe('GsScreen: a deck its cells over-cover', () => {
  it('discloses a deck whose bays cover more than it declares', async () => {
    // On a deck declaring 500 m² whose bays cover 700, every share on this
    // screen still divides by the 500 -- so Coat 3 reads 300/500 = 60,00% and
    // the shares add past 100%. That is correct and deliberate, and it is the
    // deck that is wrong; the screen has to say so rather than quietly
    // renormalising to 300/700 = 42,86% and looking consistent.
    loadGsProject.mockResolvedValue({ decks: [DECKS[1]], isMember: true })
    listDeckCells.mockResolvedValue([
      { id: 'x1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 300, stageId: 's3' },
      { id: 'x2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 400, stageId: null },
    ])
    renderScreen()

    expect(
      await screen.findByText('Diện tích các ô vượt diện tích sàn khai báo'),
    ).toBeInTheDocument()
    // Both numbers, so the foreman can see which way and by how much. Scoped to
    // the rail: the deck card beside it also prints 500,00 m².
    expect(
      within(screen.getByTestId('gs-chart-region'))
        .getByText(/Các ô cộng lại 700,00 m², sàn khai báo 500,00 m²/),
    ).toBeInTheDocument()
    // Disclosed, NOT renormalised: every share still divides by the deck's own
    // declared area, which is the denominator of every percentage in this
    // product (spec §3.2) including the one the customer is billed against.
    const rollup = within(screen.getByTestId('gs-stage-rollup'))
    expect(rollup.getAllByText('1/2 ô · 60,00%').length).toBeGreaterThan(0)
    expect(rollup.queryByText(/42,86%/)).toBeNull()
  })

  it('does not warn when the cells fit the deck, exactly or with room to spare', async () => {
    renderScreen()
    expect(await screen.findByText('15,50%')).toBeInTheDocument()
    // The Cellar Deck's cells cover 600 m² of 1000 -- the ordinary state, since
    // openings and the E-house are not cells. The unmapped slice keeps the pie
    // honest there, so there is nothing to disclose.
    expect(screen.queryByText('Diện tích các ô vượt diện tích sàn khai báo')).toBeNull()

    await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^Main Deck`) }))
    // getByTestId, not getByText: the Main Deck's one cell sits at the last
    // stage, so 100,00% is also every legend row and every spec-table cell.
    await waitFor(() =>
      expect(screen.getByTestId('gs-deck-progress')).toHaveTextContent('100,00%'))
    // The Main Deck's one cell covers its 500 m² exactly, and exact coverage is
    // the boundary that matters: at >= this banner would sit permanently on every
    // pro-rated deck, whose cell areas are divided out of the declared total and
    // therefore sum back to it.
    expect(screen.queryByText('Diện tích các ô vượt diện tích sàn khai báo')).toBeNull()
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

  it('colours the zone\'s bays and names the window once, when switched on', async () => {
    // It used to write the date range onto every bay of the zone. On a 184-bay
    // deck that is 184 copies of one answer, at a size nobody reads through a
    // glove -- and it buried the drawing the foreman is matching against the
    // paper one in his hand.
    listDeckZones.mockResolvedValue([{
      id: 'z1', name: 'Zone 1', stageId: 's5',
      startDate: '2026-08-13', finishDate: '2026-08-19',
      cellIds: ['c1'],
    }])

    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Hiện kế hoạch' }))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledWith('d1'))
    const legend = await screen.findByTestId('gs-zone-legend')
    expect(within(legend).getByText('Zone 1')).toBeInTheDocument()
    expect(within(legend).getByText('13/08 – 19/08')).toBeInTheDocument()

    // Only the zone's own bays are coloured: a deck with one zone must not
    // read as fully planned.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '#eb2f96'))
    expect(screen.getByRole('button', { name: 'ô R1C2' })).toHaveAttribute('data-color', '')
  })

  it('shows nothing when the deck has no zones yet', async () => {
    // The state this ships in. It must be a quiet no-op, not an error and not
    // an empty legend box over the corner of the drawing.
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Hiện kế hoạch' }))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledWith('d1'))
    expect(screen.queryByTestId('gs-zone-legend')).toBeNull()
    expect(screen.getByRole('button', { name: 'ô R1C1' })).toHaveAttribute('data-color', '')
  })

  it('puts the coats back when switched off again', async () => {
    listDeckZones.mockResolvedValue([{
      id: 'z1', name: 'Zone 1', stageId: 's5',
      startDate: '2026-08-13', finishDate: '2026-08-19',
      cellIds: ['c1'],
    }])

    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Hiện kế hoạch' }))
    expect(await screen.findByTestId('gs-zone-legend')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Hiện kế hoạch' }))

    await waitFor(() => expect(screen.queryByTestId('gs-zone-legend')).toBeNull())
  })
})

describe('signing out', () => {
  it('sends the foreman to the login page, not just away from their session', async () => {
    // Without the navigate the session goes but the URL stays on /gs/:id, so
    // the login form appears under a path they are no longer allowed on -- and
    // a refresh puts them straight back there.
    renderScreen()
    await screen.findByRole('tab', { name: /^Cellar Deck/ })

    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đăng xuất' }))

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }))
  })

  it('replaces the entry rather than pushing one, so Back cannot return', async () => {
    renderScreen()
    await screen.findByRole('tab', { name: /^Cellar Deck/ })
    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đăng xuất' }))
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(navigate.mock.calls[0][1]).toEqual({ replace: true })
  })
})
