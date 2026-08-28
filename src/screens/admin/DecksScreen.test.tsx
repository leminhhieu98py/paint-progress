import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DecksScreen } from './DecksScreen'

const listProjectNames = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())
const loadProjectProgress = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const listGsUsers = vi.hoisted(() => vi.fn())
const buildReportWorkbook = vi.hoisted(() => vi.fn())
const renderDeckDrawing = vi.hoisted(() => vi.fn())
const renderDeckPie = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())

vi.mock('../../lib/projectsApi', () => ({ listProjectNames: () => listProjectNames() }))
vi.mock('../../lib/decksApi', () => ({
  listDecks: (p: string) => listDecks(p),
  getDrawingUrl: (p: string) => getDrawingUrl(p),
}))
vi.mock('../../lib/progressApi', () => ({
  loadProjectProgress: (id: string) => loadProjectProgress(id),
}))
vi.mock('../../lib/gsApi', () => ({ listDeckZones: (d: string) => listDeckZones(d) }))
vi.mock('../../lib/adminApi', () => ({ listGsUsers: () => listGsUsers() }))
vi.mock('../../lib/reportXlsx', () => ({
  buildReportWorkbook: (i: unknown) => buildReportWorkbook(i),
  reportFileName: (c: string, d: string) => `tien-do-${c}-${d}.xlsx`,
}))
// jsdom implements no canvas, so the snapshot module cannot run here.
vi.mock('../../canvas/deckSnapshot', () => ({
  renderDeckDrawing: (...a: unknown[]) => renderDeckDrawing(...a),
  renderDeckPie: (...a: unknown[]) => renderDeckPie(...a),
}))

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.4 },
  { id: 's2', seq: 2, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]

/**
 * CD is 1000 m² and half-way to the last stage; WD is 3000 m² and untouched.
 * Deliberately unequal, and named apart from the deck-list fixture above: with
 * equal areas every share would read 50,00% and collide with CD's progress, and
 * the assertions would pass on the wrong cell.
 */
const ENTRIES = [
  {
    seq: 1,
    deck: {
      id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000,
      cells: [{ id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 500, stageId: 's2' }],
    },
    stages: STAGES, imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
    areaSource: 'guides' as const, audit: {},
  },
  {
    seq: 2,
    deck: { id: 'd2', code: 'WD', name: 'Weather Deck', totalAreaM2: 3000, cells: [] },
    stages: STAGES, imagePath: null, imageW: null, imageH: null,
    areaSource: 'guides' as const, audit: {},
  },
]

beforeEach(() => {
  for (const m of [
    listProjectNames, listDecks, loadProjectProgress, listDeckZones, listGsUsers,
    buildReportWorkbook, renderDeckDrawing, renderDeckPie, getDrawingUrl,
  ]) m.mockReset()
  loadProjectProgress.mockResolvedValue(ENTRIES)
  listDeckZones.mockResolvedValue([])
  listGsUsers.mockResolvedValue([{ id: 'u1', fullName: 'Nguyễn Văn A' }])
  buildReportWorkbook.mockResolvedValue(new Blob(['x']))
  renderDeckDrawing.mockResolvedValue('PNGDATA')
  renderDeckPie.mockReturnValue('PIEDATA')
  getDrawingUrl.mockImplementation((p: string) => Promise.resolve(`https://signed/${p}`))
  listProjectNames.mockResolvedValue([{ id: 'p1', name: 'BB1', code: 'BB1' }])
  listDecks.mockResolvedValue([
    {
      id: 'd1', projectId: 'p1', seq: 1, name: 'Main Deck', code: 'MD',
      imagePath: null, imageW: null, imageH: null, drawingName: null, drawingPage: null,
      totalAreaM2: 5258.5, areaSource: 'prorated', cellCount: 24,
    },
  ])
})

/**
 * Rendered inside a router that echoes wherever the screen navigates to.
 *
 * Where it goes IS what this screen does now -- creating a deck and attaching
 * its drawing both moved to the deck's own address -- so a stand-in that only
 * proved "something was clicked" would leave the whole of it unchecked.
 */
const renderScreen = () =>
  render(
    <MemoryRouter initialEntries={['/decks']}>
      <Routes>
        <Route path="/decks" element={<DecksScreen />} />
        <Route path="/decks/:deckId" element={<div>deck page</div>} />
      </Routes>
    </MemoryRouter>,
  )

describe('DecksScreen', () => {
  it('lists the decks of the first project', async () => {
    renderScreen()

    expect(await screen.findByText('Main Deck')).toBeInTheDocument()
    expect(screen.getByText('MD')).toBeInTheDocument()
    expect(screen.getByText('5.258,50')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    await waitFor(() => expect(listDecks).toHaveBeenCalledWith('p1'))
  })

  it('says whether a deck has a drawing yet, without offering to attach one', async () => {
    // Attaching a drawing belongs to the deck, and the deck has a page of its
    // own. A row that still carried a file picker would be a second way in,
    // with its own idea of which file types are allowed.
    renderScreen()

    expect(await screen.findByText('Chưa có')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tải bản vẽ' })).not.toBeInTheDocument()
  })

  it('opens the deck at its own address', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Mở' }))

    expect(await screen.findByText('deck page')).toBeInTheDocument()
  })

  it('sends "Tạo sàn" to the new-deck page, carrying the project it belongs to', async () => {
    // The project is in the URL rather than in navigation state so that a
    // reload of the create form still knows which project it is creating in.
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Tạo sàn' }))

    expect(await screen.findByText('deck page')).toBeInTheDocument()
  })

  it('shows an empty state, not a spinner, when there is no project at all', async () => {
    // The table initialises loading, and with no project to load nothing else
    // would ever turn it off: the admin gets a spinner for ever.
    listProjectNames.mockResolvedValue([])
    renderScreen()

    // No row, and no spinner either: asserted on the table's own body rather
    // than on antd's empty-state wording, which is translated.
    await waitFor(() => expect(document.querySelector('.ant-spin-spinning')).toBeNull())
    expect(document.querySelectorAll('.ant-table-tbody .ant-table-row')).toHaveLength(0)
    expect(listDecks).not.toHaveBeenCalled()
  })

  it('reports a failed project list rather than showing an empty one', async () => {
    listProjectNames.mockRejectedValue(new Error('JWT expired'))
    renderScreen()

    expect(await screen.findByText('JWT expired')).toBeInTheDocument()
  })
})

describe('DecksScreen — the project-wide half of progress', () => {
  it('rolls the project up, one row per deck plus a total', async () => {
    // CD: 500 m² of 1000 at the last of two stages -> .4*.5 + .6*.5 = 50,00%.
    // WD: nothing -> 0,00%. Weighted by area (1000 vs 3000) the project is
    // 0,25*50% = 12,50%.
    renderScreen()

    const rollup = await screen.findByTestId('project-rollup')
    expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument()
    expect(within(rollup).getByText('Weather Deck')).toBeInTheDocument()
    expect(within(rollup).getByText('25,00%')).toBeInTheDocument()   // CD's share
    expect(within(rollup).getByText('75,00%')).toBeInTheDocument()   // WD's share
    expect(within(rollup).getByText('50,00%')).toBeInTheDocument()   // CD's progress
    expect(within(rollup).getByText('12,50%')).toBeInTheDocument()   // the project
  })

  it('exports every deck of the project, with its own stages, plan and pictures', async () => {
    // Every deck, not the one someone happened to open: the Overview sheet is
    // the whole project, and this list is the only screen with one selected.
    renderScreen()
    await screen.findByTestId('project-rollup')

    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))

    await waitFor(() => expect(buildReportWorkbook).toHaveBeenCalledTimes(1))
    const [input] = buildReportWorkbook.mock.calls[0]
    expect(input.decks.map((d: { deck: { code: string } }) => d.deck.code)).toEqual(['CD', 'WD'])
    expect(input.decks[0].userNames).toEqual({ u1: 'Nguyễn Văn A' })
    expect(input.images.d1.drawingPng).toBe('PNGDATA')
    // A deck with no drawing has no snapshot to take, and must not block the
    // rest of the export.
    expect(input.images.d2.drawingPng).toBeNull()
    expect(input.images.d2.piePng).toBe('PIEDATA')
  })

  it('exports anyway when the profile list cannot be read', async () => {
    // The names are a convenience; the ids in the sheet are still traceable
    // through cell_events. Losing them must not lose the report.
    listGsUsers.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    await screen.findByTestId('project-rollup')

    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))

    await waitFor(() => expect(buildReportWorkbook).toHaveBeenCalled())
    expect(buildReportWorkbook.mock.calls[0][0].decks[0].userNames).toEqual({})
  })

  it('surfaces a failed export instead of failing silently', async () => {
    buildReportWorkbook.mockRejectedValue(new Error('out of memory'))
    renderScreen()
    await screen.findByTestId('project-rollup')

    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))

    expect(await screen.findByText(/out of memory/)).toBeInTheDocument()
  })

  it('says so, and offers no export, when the project has no decks', async () => {
    loadProjectProgress.mockResolvedValue([])
    renderScreen()

    expect(await screen.findByText('Dự án này chưa có sàn nào')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Xuất báo cáo/ })).toBeDisabled()
  })
})
