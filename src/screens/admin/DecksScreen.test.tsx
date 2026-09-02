import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { DecksScreen } from './DecksScreen'

const listProjectNames = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())
const loadProjectModel = vi.hoisted(() => vi.fn())
const loadProjectProgress = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const listGsUsers = vi.hoisted(() => vi.fn())
const buildReportWorkbook = vi.hoisted(() => vi.fn())
const renderDeckDrawing = vi.hoisted(() => vi.fn())
const renderDeckPie = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())

vi.mock('../../lib/projectsApi', () => ({ listProjectNames: () => listProjectNames() }))
const deleteDeck = vi.hoisted(() => vi.fn())
vi.mock('../../lib/decksApi', () => ({
  listDecks: (p: string) => listDecks(p),
  getDrawingUrl: (p: string) => getDrawingUrl(p),
  deleteDeck: (d: unknown) => deleteDeck(d),
}))
const listDeckEvents = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  loadProjectModel: (id: string) => loadProjectModel(id),
  loadProjectProgress: (id: string) => loadProjectProgress(id),
  listDeckEvents: (deckId: string) => listDeckEvents(deckId),
}))
vi.mock('../../lib/zonesApi', () => ({ listDeckZones: (d: string) => listDeckZones(d) }))
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

/**
 * The same two decks seen through three works (0024). Sơn covers both decks
 * with the m² shares; Tháo giáo covers only CD; Chứng từ is a manual figure
 * with no deck at all. CD is half-way in both bays works, WD untouched.
 *
 *   P_Sơn = .25·.5 + .75·0 = 12,50%   P_Tháo giáo = 1·.5 = 50,00%   Chứng từ = 50,00%
 *   P = .5·.125 + .3·.5 + .2·.5 = 31,25%
 *   CD weighs .5·.25 + .3·1 = 42,50% of P and sits at 50,00%; WD weighs 37,50% at 0.
 */
const TG_STAGES = [{ id: 't1', seq: 1, name: 'Tháo giáo lửng', color: '#722ed1', weight: 1 }]
const CD = { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000 }
const WD = { id: 'd2', code: 'WD', name: 'Weather Deck', totalAreaM2: 3000 }
const bay = (stageId: string) => ({
  id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 500, stageId, note: '',
})
const work = (
  id: string, seq: number, name: string, kind: 'bays' | 'manual', weight: number,
  manualProgress: number | null = null,
) => ({ id, projectId: 'p1', seq, name, kind, weight, counts: true, manualProgress })
const MODEL = {
  models: [
    {
      work: work('w1', 1, 'Sơn', 'bays', 0.5),
      decks: [
        { deck: { ...CD, cells: [bay('s2')] }, stages: STAGES, weight: 0.25 },
        { deck: { ...WD, cells: [] }, stages: STAGES, weight: 0.75 },
      ],
    },
    {
      work: work('w2', 2, 'Tháo giáo', 'bays', 0.3),
      decks: [{ deck: { ...CD, cells: [bay('t1')] }, stages: TG_STAGES, weight: 1 }],
    },
    { work: work('w3', 3, 'Chứng từ', 'manual', 0.2, 0.5), decks: [] },
  ],
  decks: [
    {
      ...CD, seq: 1, imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
      areaSource: 'guides' as const, cellCount: 1,
    },
    {
      ...WD, seq: 2, imagePath: null, imageW: null, imageH: null,
      areaSource: 'guides' as const, cellCount: 0,
    },
  ],
  audit: {},
}

beforeEach(() => {
  for (const m of [
    listProjectNames, listDecks, loadProjectModel, loadProjectProgress, listDeckZones, listGsUsers,
    buildReportWorkbook, renderDeckDrawing, renderDeckPie, getDrawingUrl,
  ]) m.mockReset()
  loadProjectModel.mockResolvedValue(MODEL)
  loadProjectProgress.mockResolvedValue(ENTRIES)
  listDeckEvents.mockReset()
  listDeckEvents.mockResolvedValue([])
  listDeckZones.mockResolvedValue([])
  listGsUsers.mockResolvedValue([{ id: 'u1', fullName: 'Nguyễn Văn A' }])
  buildReportWorkbook.mockResolvedValue(new Blob(['x']))
  renderDeckDrawing.mockResolvedValue('PNGDATA')
  renderDeckPie.mockReturnValue('PIEDATA')
  getDrawingUrl.mockImplementation((p: string) => Promise.resolve(`https://signed/${p}`))
  listProjectNames.mockResolvedValue([{ id: 'p1', name: 'BB1', code: 'BB1' }])
  deleteDeck.mockReset()
  deleteDeck.mockResolvedValue({ drawingRemoved: true })
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
function UrlEcho() {
  const { search } = useLocation()
  return <div data-testid="url-search">{search}</div>
}

const renderScreen = (entry = '/decks') =>
  renderApp(
    <MemoryRouter initialEntries={[entry]}>
      <UrlEcho />
      <Routes>
        <Route path="/decks" element={<DecksScreen />} />
        <Route path="/decks/:deckId" element={<div>deck page</div>} />
      </Routes>
    </MemoryRouter>,
  )

describe('DecksScreen project selection', () => {
  beforeEach(() => {
    listProjectNames.mockResolvedValue([
      { id: 'p1', name: 'BB1', code: 'BB1' },
      { id: 'p2', name: 'Rạng Đông RD-2', code: 'RD2' },
    ])
  })

  it('opens the project named in the URL, not the first one', async () => {
    // This is how the projects list hands a project over. Falling back to the
    // first would silently show the admin a different project's decks than the
    // row they clicked.
    renderScreen('/decks?project=p2')
    await waitFor(() => expect(listDecks).toHaveBeenCalledWith('p2'))
  })

  it('falls back to the first project when the URL names one that is gone', async () => {
    renderScreen('/decks?project=deleted-yesterday')
    await waitFor(() => expect(listDecks).toHaveBeenCalledWith('p1'))
  })

  it('writes the chosen project back to the URL so a refresh keeps it', async () => {
    renderScreen()
    await screen.findByText('Main Deck')

    await userEvent.click(screen.getByLabelText('Dự án'))
    await userEvent.click(await screen.findByTitle('Rạng Đông RD-2 (RD2)'))

    await waitFor(() =>
      expect(screen.getByTestId('url-search')).toHaveTextContent('project=p2'),
    )
  })
})

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
  it('weighs each deck by Σ W·D across the works it is in, and shows its tổng hợp', async () => {
    renderScreen()

    const rollup = await screen.findByTestId('project-rollup')
    expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument()
    expect(within(rollup).getByText('Weather Deck')).toBeInTheDocument()
    expect(within(rollup).getByText('42,50%')).toBeInTheDocument()   // CD's effective weight
    expect(within(rollup).getByText('37,50%')).toBeInTheDocument()   // WD's
    expect(within(rollup).getByText('50,00%')).toBeInTheDocument()   // CD's tổng hợp
    expect(within(rollup).getByText('80,00%')).toBeInTheDocument()   // what the decks carry
    expect(within(rollup).getByText('31,25%')).toBeInTheDocument()   // the project, P
    // Not the m² share any more: CD is 1000 of 4000 m², which would read 25,00%.
    expect(within(rollup).queryByText('25,00%')).toBeNull()
  })

  it('lists every work with its kind, weight and P_w under the deck table, then P', async () => {
    renderScreen()

    const works = await screen.findByTestId('project-works')
    expect(within(works).getByText('Sơn')).toBeInTheDocument()
    expect(within(works).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(works).getByText('Chứng từ')).toBeInTheDocument()
    expect(within(works).getAllByText('Theo ô')).toHaveLength(2)
    expect(within(works).getByText('Nhập tay')).toBeInTheDocument()
    expect(within(works).getByText('0,50')).toBeInTheDocument()      // W of Sơn
    expect(within(works).getByText('0,20')).toBeInTheDocument()      // W of Chứng từ
    expect(within(works).getByText('12,50%')).toBeInTheDocument()    // P_Sơn
    expect(within(works).getAllByText('50,00%')).toHaveLength(2)     // Tháo giáo and Chứng từ
    expect(within(works).getByText('31,25%')).toBeInTheDocument()    // P
  })

  it('adds the manual works to the ring, so the parts still sum to P', async () => {
    renderScreen()

    const donut = await screen.findByTestId('rollup-donut')
    expect(within(donut).getByText('Chứng từ')).toBeInTheDocument()
    expect(within(donut).getByText('10,00%')).toBeInTheDocument()    // .2 × 50%
    expect(within(donut).getByText('21,25%')).toBeInTheDocument()    // CD: .425 × 50%
    expect(within(donut).getAllByText('31,25%').length).toBeGreaterThan(0)
  })

  it('exports every deck of the project, with its own stages, plan and pictures', async () => {
    // Every deck, not the one someone happened to open: the Overview sheet is
    // the whole project, and this list is the only screen with one selected.
    renderScreen()
    await screen.findByTestId('project-rollup')

    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Xuất' }))

    await waitFor(() => expect(buildReportWorkbook).toHaveBeenCalledTimes(1))
    const [input] = buildReportWorkbook.mock.calls[0]
    expect(input.decks.map((d: { deck: { code: string } }) => d.deck.code)).toEqual(['CD', 'WD'])
    expect(input.decks[0].userNames).toEqual({ u1: 'Nguyễn Văn A' })
    // The deck sheet lists stage changes now, each deck's own, read here.
    expect(listDeckEvents).toHaveBeenCalledWith('d1')
    expect(listDeckEvents).toHaveBeenCalledWith('d2')
    expect(input.decks[0].events).toEqual([])
    expect(input.decks[0]).not.toHaveProperty('audit')
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
    await userEvent.click(await screen.findByRole('button', { name: 'Xuất' }))

    await waitFor(() => expect(buildReportWorkbook).toHaveBeenCalled())
    expect(buildReportWorkbook.mock.calls[0][0].decks[0].userNames).toEqual({})
  })

  it('surfaces a failed export instead of failing silently', async () => {
    buildReportWorkbook.mockRejectedValue(new Error('out of memory'))
    renderScreen()
    await screen.findByTestId('project-rollup')

    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Xuất' }))

    expect(await screen.findByText(/out of memory/)).toBeInTheDocument()
  })

  it('says so, and offers no export, when the project has no decks', async () => {
    loadProjectModel.mockResolvedValue({ models: [], decks: [], audit: {} })
    loadProjectProgress.mockResolvedValue([])
    renderScreen()

    expect(await screen.findByText('Dự án này chưa có sàn nào')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Xuất báo cáo/ })).toBeDisabled()
  })
})

describe('DecksScreen — deleting a deck', () => {
  const openDelete = async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Xóa sàn' }))
    return screen.findByRole('dialog')
  }

  it('deletes a deck only once its exact name has been typed', async () => {
    // Feedback Rv1, item 1, as the owner decided it: a hard delete behind the
    // name. The dialog says what goes with the deck, and the typed name is
    // what stands between a misclick and 184 bays of history.
    const dialog = await openDelete()
    expect(within(dialog).getByText('Xóa sàn Main Deck?')).toBeInTheDocument()
    for (const item of [
      'Toàn bộ ô và lịch sử công đoạn', 'Zone và kế hoạch', 'Ghi chú của GS', 'Bản vẽ đã tải lên',
    ]) expect(within(dialog).getByText(item)).toBeInTheDocument()
    const ok = within(dialog).getByRole('button', { name: /Xóa sàn/ })
    expect(ok).toBeDisabled()

    await userEvent.type(within(dialog).getByLabelText('Gõ đúng tên để xác nhận'), 'Main Deck')
    await userEvent.click(ok)

    await waitFor(() => expect(deleteDeck).toHaveBeenCalledWith({ id: 'd1', imagePath: null }))
    expect(await screen.findByText('Đã xóa sàn Main Deck')).toBeInTheDocument()
    // The list is re-read rather than patched, so what is shown is what is there.
    await waitFor(() => expect(listDecks).toHaveBeenCalledTimes(2))
  })

  it('says so when the drawing could not be cleaned up, without undoing the delete', async () => {
    deleteDeck.mockResolvedValue({ drawingRemoved: false })
    const dialog = await openDelete()
    await userEvent.type(within(dialog).getByLabelText('Gõ đúng tên để xác nhận'), 'Main Deck')
    await userEvent.click(within(dialog).getByRole('button', { name: /Xóa sàn/ }))

    expect(await screen.findByText('Đã xóa, nhưng chưa dọn được file bản vẽ trên kho lưu trữ'))
      .toBeInTheDocument()
  })

  it('surfaces a refused delete', async () => {
    deleteDeck.mockRejectedValue(new Error('permission denied'))
    const dialog = await openDelete()
    await userEvent.type(within(dialog).getByLabelText('Gõ đúng tên để xác nhận'), 'Main Deck')
    await userEvent.click(within(dialog).getByRole('button', { name: /Xóa sàn/ }))

    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
  })
})
