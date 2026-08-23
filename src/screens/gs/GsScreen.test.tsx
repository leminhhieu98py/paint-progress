import { App as AntApp } from 'antd'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GsScreen } from './GsScreen'

const loadGsProject = vi.hoisted(() => vi.fn())
const listDeckCells = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())

vi.mock('../../lib/gsApi', () => ({
  loadGsProject: (projectId: string) => loadGsProject(projectId),
  listDeckCells: (deckId: string) => listDeckCells(deckId),
  setCellStage: vi.fn(),
  subscribeDeckCells: vi.fn(() => () => {}),
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
    imageUrl, cells, cellColors, panZoom, onCellClick,
  }: {
    imageUrl: string
    cells: { code: string }[]
    cellColors?: Record<string, string>
    panZoom?: boolean
    onCellClick?: (code: string, additive: boolean) => void
  }) => (
    <div data-testid="canvas" data-image={imageUrl} data-panzoom={String(Boolean(panZoom))}>
      {cells.map((c) => (
        <button key={c.code} data-color={cellColors?.[c.code] ?? ''} onClick={() => onCellClick?.(c.code, false)}>
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

beforeEach(() => {
  loadGsProject.mockReset()
  listDeckCells.mockReset()
  getDrawingUrl.mockReset()
  signOut.mockReset()
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
