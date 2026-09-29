import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { DecksScreen } from './DecksScreen'

const listProjectNames = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())
const loadProjectModel = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const listGsUsers = vi.hoisted(() => vi.fn())
const buildReportWorkbook = vi.hoisted(() => vi.fn())
const renderDeckDrawing = vi.hoisted(() => vi.fn())
const renderDeckPie = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())

vi.mock('../../lib/projectsApi', () => ({ listProjectNames: () => listProjectNames() }))
const deleteDeck = vi.hoisted(() => vi.fn())
const duplicateDeck = vi.hoisted(() => vi.fn())
const swapDeckSeq = vi.hoisted(() => vi.fn())
vi.mock('../../lib/decksApi', () => ({
  listDecks: (p: string) => listDecks(p),
  getDrawingUrl: (p: string) => getDrawingUrl(p),
  deleteDeck: (d: unknown) => deleteDeck(d),
  duplicateDeck: (src: unknown, input: unknown) => duplicateDeck(src, input),
  swapDeckSeq: (a: unknown, b: unknown) => swapDeckSeq(a, b),
}))
const listDeckEvents = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  loadProjectModel: (id: string) => loadProjectModel(id),
  listDeckEvents: (deckId: string) => listDeckEvents(deckId),
}))
vi.mock('../../lib/zonesApi', () => ({ listDeckZones: (d: string) => listDeckZones(d) }))
vi.mock('../../lib/adminApi', () => ({ listGsUsers: () => listGsUsers() }))
vi.mock('../../lib/reportXlsx', () => ({
  buildReportWorkbook: (i: unknown) => buildReportWorkbook(i),
  reportFileName: (c: string, d: string) => `tien-do-${c}-${d}.xlsx`,
}))
// jsdom implements no canvas, so the snapshot module cannot run here.
const renderPlanDrawing = vi.hoisted(() => vi.fn())
vi.mock('../../canvas/deckSnapshot', () => ({
  renderDeckDrawing: (...a: unknown[]) => renderDeckDrawing(...a),
  renderDeckPie: (...a: unknown[]) => renderDeckPie(...a),
  renderPlanDrawing: (...a: unknown[]) => renderPlanDrawing(...a),
}))

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.4 },
  { id: 's2', seq: 2, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
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
) => ({ id, projectId: 'p1', seq, name, kind, weight, counts: true, manualProgress, quantityLabel: 'Diện tích', unit: 'm²' })
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
    listProjectNames, listDecks, loadProjectModel, listDeckZones, listGsUsers,
    buildReportWorkbook, renderDeckDrawing, renderDeckPie, renderPlanDrawing, getDrawingUrl,
  ]) m.mockReset()
  renderPlanDrawing.mockResolvedValue('PLANPNG')
  loadProjectModel.mockResolvedValue(MODEL)
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
  duplicateDeck.mockReset()
  duplicateDeck.mockResolvedValue({ deckId: 'd9', drawingCopied: true })
  swapDeckSeq.mockReset()
  swapDeckSeq.mockResolvedValue(undefined)
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
  it('hides a deck that carries no weight from the rollup table, and says so', async () => {
    // Feedback Rv2 item 4: a "Test data" deck in no counted work sat in the
    // rollup at 0,00% for ever. It still exists -- the Sàn list above keeps
    // it, and the works table is untouched -- it just does not count.
    const TD = { id: 'd3', code: 'TD', name: 'Test data', totalAreaM2: 100 }
    loadProjectModel.mockResolvedValue({
      ...MODEL,
      decks: [
        ...MODEL.decks,
        { ...TD, seq: 3, imagePath: null, imageW: null, imageH: null, areaSource: 'guides' as const, cellCount: 0 },
      ],
    })
    listDecks.mockResolvedValue([{
      id: 'd3', projectId: 'p1', seq: 3, name: 'Test data', code: 'TD',
      imagePath: null, imageW: null, imageH: null, drawingName: null, drawingPage: null,
      totalAreaM2: 100, areaSource: 'guides', cellCount: 0,
    }])
    renderScreen()

    const rollup = await screen.findByTestId('project-rollup')
    await waitFor(() => expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument())
    expect(within(rollup).queryByText('Test data')).toBeNull()
    expect(within(rollup).getByText(/Đã ẩn 1 sàn có tỉ trọng 0,00%/)).toBeInTheDocument()
    // Still a deck of the project, in the list that says what exists.
    expect(screen.getAllByText('Test data').length).toBeGreaterThan(0)
  })

  /** MODEL plus a deck in no work at all: 100 m² that weighs nothing in P. */
  const withZeroWeightDeck = () =>
    loadProjectModel.mockResolvedValue({
      ...MODEL,
      decks: [
        ...MODEL.decks,
        {
          id: 'd3', code: 'TD', name: 'Test data', totalAreaM2: 100, seq: 3,
          imagePath: null, imageW: null, imageH: null, areaSource: 'guides' as const, cellCount: 0,
        },
      ],
    })

  it('keeps a zero-weight deck out of the ring as well as out of the table', async () => {
    // Feedback Rv5, item 1: the arc gets nothing from a zero weight, but the
    // LEGEND listed all eleven decks, six of them at 0,00% -- exactly the
    // noise that hiding the table rows was meant to remove.
    withZeroWeightDeck()
    renderScreen()

    const donut = await screen.findByTestId('rollup-donut')
    // RV6-01: the legend labels a deck slice by its code, not its name.
    await waitFor(() => expect(within(donut).getByText('CD')).toBeInTheDocument())
    expect(within(donut).queryByText('Test data')).toBeNull()
    expect(within(donut).queryByText('TD')).toBeNull()
    // A counted manual work is not a deck: it carries real weight in P and
    // keeps its slice.
    expect(within(donut).getByText('Chứng từ')).toBeInTheDocument()
  })

  it('totals the m² of the decks the table lists, not of every deck in the project', async () => {
    // Feedback Rv5, item 3: 194.525,00 printed under a visible sum of
    // 160.229,00. Here: CD 1000 + WD 3000, with the 100 m² of Test data out.
    withZeroWeightDeck()
    renderScreen()

    const rollup = await screen.findByTestId('project-rollup')
    await waitFor(() => expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument())
    expect(within(rollup).getByText('4.000,00')).toBeInTheDocument()
    expect(within(rollup).queryByText('4.100,00')).toBeNull()
  })

  it('says nothing about hidden decks when every deck counts', async () => {
    renderScreen()
    const rollup = await screen.findByTestId('project-rollup')
    await waitFor(() => expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument())
    expect(within(rollup).queryByText(/Đã ẩn/)).toBeNull()
  })

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
    // RV6-02: the legend shows each slice's own progress (Chứng từ's is
    // 50,00%, same as CD's), not the weight × progress the arc is sized by
    // -- see the dedicated RV6-01/02 tests below for the arc math itself.
    expect(within(donut).getAllByText('50,00%').length).toBeGreaterThan(0)
    expect(within(donut).getAllByText('31,25%').length).toBeGreaterThan(0)
  })

  it('labels deck slices by code and shows each one\'s own progress in the legend, ' +
    'and the contribution beside it, while the arc keeps weight × progress (RV6-01, RV6-02, RV6-40)', async () => {
    renderScreen()

    const rollup = await screen.findByTestId('project-rollup')
    await waitFor(() => expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument())
    const donut = await screen.findByTestId('rollup-donut')

    // RV6-01: labelled by code, not name -- a work has no code, so it keeps
    // its name.
    expect(within(donut).getByText('CD')).toBeInTheDocument()
    expect(within(donut).getByText('WD')).toBeInTheDocument()
    expect(within(donut).queryByText('Cellar Deck')).toBeNull()
    expect(within(donut).queryByText('Weather Deck')).toBeNull()

    // RV6-02: the first number beside CD is its own progress, 50,00% -- the
    // same figure the rollup table's Tiến độ column reads for CD. RV6-40
    // (Linh's review of v1.7.0): the second number is the contribution the
    // arc is sized by, 21,25% (.425 effective weight × 50%), so the column
    // adds up to the centre figure; the legend says which is which.
    expect(within(rollup).getByText('50,00%')).toBeInTheDocument()
    expect(within(donut).getByText('Tiến độ · Đóng góp')).toBeInTheDocument()
    const cdRow = within(donut).getByText('CD').closest('[data-testid="legend-row"]') as HTMLElement
    expect(within(cdRow).getByText('50,00%')).toBeInTheDocument()
    expect(within(cdRow).getByText('21,25%')).toBeInTheDocument()

    // The arc itself is untouched: the ring's conic-gradient still runs CD's
    // solid band up to 20.750% (21,25% minus the hairline gap), i.e. weight
    // × progress, not the 50% shown in the legend.
    const ring = within(donut).getByTestId('donut-ring')
    expect(ring.style.background).toContain('20.750%')
  })

  it('removes the trọng số × tiến độ caption under the legend (RV6-03)', async () => {
    renderScreen()

    await screen.findByTestId('rollup-donut')
    expect(screen.queryByText(/Mỗi phần là trọng số/)).toBeNull()
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
    // The model the screen already holds: every work with its decks, coats
    // and states, so the Overview blocks are the same figures as the rollup.
    expect(input.works).toBe(MODEL.models)
    expect(input.decks.map((d: { deck: { code: string } }) => d.deck.code)).toEqual(['CD', 'WD'])
    expect(input.decks[0].userNames).toEqual({ u1: 'Nguyễn Văn A' })
    // The deck sheet's mesh, from the first work that carries the deck.
    expect(input.decks[0].deck.cells.map((c: { id: string }) => c.id)).toEqual(['c1'])
    expect(input.decks[0]).not.toHaveProperty('stages')
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

  it('puts one layout picture per (deck, work) with a plan under the Plan table', async () => {
    // Feedback Rv2 item 10. CD has a zone on Sơn's last coat; WD has no plan
    // and no drawing; Tháo giáo covers CD but has no zone -> exactly one.
    listDeckZones.mockImplementation((deckId: string) => Promise.resolve(
      deckId === 'd1'
        ? [{
            id: 'z1', name: 'Khu A', stageId: 's2', color: null,
            startDate: '2026-09-01', finishDate: '2026-09-07', cellIds: ['c1'],
          }]
        : [],
    ))
    renderScreen()
    await screen.findByTestId('project-rollup')
    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Xuất' }))

    await waitFor(() => expect(buildReportWorkbook).toHaveBeenCalledTimes(1))
    const [input] = buildReportWorkbook.mock.calls[0]
    expect(input.planImages).toEqual([{
      deckName: 'Cellar Deck', workName: 'Sơn', lastStageName: 'Tháo giáo', png: 'PLANPNG', aspect: 0.8,
    }])
    expect(renderPlanDrawing).toHaveBeenCalledTimes(1)
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

describe('DecksScreen — duplicating a deck (Feedback Rv2, item 3)', () => {
  const openDuplicate = async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Nhân bản sàn' }))
    return screen.findByRole('dialog')
  }

  it('proposes a name and a code, says what is copied, and opens the copy', async () => {
    const dialog = await openDuplicate()
    expect(within(dialog).getByText('Nhân bản sàn «Main Deck»')).toBeInTheDocument()
    expect(within(dialog).getByText(/Không sao chép công việc, lớp sơn, tiến độ hay kế hoạch/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Tên sàn mới')).toHaveValue('Main Deck (bản sao)')
    expect(within(dialog).getByLabelText('Mã sàn mới')).toHaveValue('MD-2')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Nhân bản' }))

    await waitFor(() => expect(duplicateDeck).toHaveBeenCalledWith(
      { id: 'd1', projectId: 'p1', imagePath: null },
      { name: 'Main Deck (bản sao)', code: 'MD-2' },
    ))
    expect(await screen.findByText('deck page')).toBeInTheDocument()
  })

  it('refuses a code the project already uses', async () => {
    const dialog = await openDuplicate()
    const code = within(dialog).getByLabelText('Mã sàn mới')
    await userEvent.clear(code)
    await userEvent.type(code, 'MD')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nhân bản' }))

    expect(await screen.findByText('Mã sàn đã dùng trong dự án này')).toBeInTheDocument()
    expect(duplicateDeck).not.toHaveBeenCalled()
  })

  it('says so when the copy landed without its drawing', async () => {
    duplicateDeck.mockResolvedValue({ deckId: 'd9', drawingCopied: false })
    const dialog = await openDuplicate()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nhân bản' }))
    expect(await screen.findByText(/chưa sao chép được bản vẽ/)).toBeInTheDocument()
  })
})

describe('DecksScreen — reordering decks (RV6-05, RV6-06)', () => {
  const THREE_DECKS = [
    {
      id: 'd1', projectId: 'p1', seq: 1, name: 'First Deck', code: 'FD',
      imagePath: null, imageW: null, imageH: null, drawingName: null, drawingPage: null,
      totalAreaM2: 100, areaSource: 'prorated' as const, cellCount: 1,
    },
    {
      id: 'd2', projectId: 'p1', seq: 2, name: 'Second Deck', code: 'SD',
      imagePath: null, imageW: null, imageH: null, drawingName: null, drawingPage: null,
      totalAreaM2: 100, areaSource: 'prorated' as const, cellCount: 1,
    },
    {
      id: 'd3', projectId: 'p1', seq: 3, name: 'Third Deck', code: 'TD',
      imagePath: null, imageW: null, imageH: null, drawingName: null, drawingPage: null,
      totalAreaM2: 100, areaSource: 'prorated' as const, cellCount: 1,
    },
  ]

  beforeEach(() => {
    listDecks.mockResolvedValue(THREE_DECKS)
  })

  it('keeps the row actions and the order arrows in view while the list scrolls sideways (QA F8 follow-up)', async () => {
    // Seen at 1024px after F8: the list scrolled sideways and took Mở, Nhân
    // bản, Xoá and Lên/Xuống past the card's right edge. Both columns are pinned.
    renderScreen()
    await screen.findByText('First Deck')
    expect(screen.getAllByRole('button', { name: 'Lên' })[0].closest('td'))
      .toHaveClass('ant-table-cell-fix-right')
    expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toHaveClass('ant-table-cell-fix-right')
  })

  it('disables Lên on the first row and Xuống on the last, leaving the rest enabled', async () => {
    renderScreen()
    await screen.findByText('First Deck')

    const ups = screen.getAllByRole('button', { name: 'Lên' })
    const downs = screen.getAllByRole('button', { name: 'Xuống' })
    expect(ups).toHaveLength(3)
    expect(downs).toHaveLength(3)
    expect(ups[0]).toBeDisabled()
    expect(ups[1]).toBeEnabled()
    expect(ups[2]).toBeEnabled()
    expect(downs[0]).toBeEnabled()
    expect(downs[1]).toBeEnabled()
    expect(downs[2]).toBeDisabled()
  })

  it('clicking Xuống on the first row swaps it with its neighbour and reloads the list', async () => {
    renderScreen()
    await screen.findByText('First Deck')
    listDecks.mockClear()

    const downs = screen.getAllByRole('button', { name: 'Xuống' })
    await userEvent.click(downs[0])

    await waitFor(() => expect(swapDeckSeq).toHaveBeenCalledWith(
      { id: 'd1', seq: 1 }, { id: 'd2', seq: 2 },
    ))
    await waitFor(() => expect(listDecks).toHaveBeenCalledWith('p1'))
  })

  it('clicking Lên on the last row swaps it with its neighbour above', async () => {
    renderScreen()
    await screen.findByText('First Deck')
    listDecks.mockClear()

    const ups = screen.getAllByRole('button', { name: 'Lên' })
    await userEvent.click(ups[2])

    await waitFor(() => expect(swapDeckSeq).toHaveBeenCalledWith(
      { id: 'd3', seq: 3 }, { id: 'd2', seq: 2 },
    ))
    await waitFor(() => expect(listDecks).toHaveBeenCalledWith('p1'))
  })

  it('surfaces a refused swap instead of failing silently', async () => {
    swapDeckSeq.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    await screen.findByText('First Deck')

    const downs = screen.getAllByRole('button', { name: 'Xuống' })
    await userEvent.click(downs[0])

    expect(await screen.findByText('permission denied')).toBeInTheDocument()
  })

  it('ignores a second click while a swap is in flight, then re-enables the arrows', async () => {
    let settle!: () => void
    swapDeckSeq.mockReturnValue(new Promise<void>((resolve) => { settle = resolve }))
    renderScreen()
    await screen.findByText('First Deck')

    const downs = screen.getAllByRole('button', { name: 'Xuống' })
    await userEvent.click(downs[0])
    await userEvent.click(downs[0])

    expect(swapDeckSeq).toHaveBeenCalledTimes(1)
    for (const b of screen.getAllByRole('button', { name: 'Xuống' })) expect(b).toBeDisabled()
    for (const b of screen.getAllByRole('button', { name: 'Lên' })) expect(b).toBeDisabled()

    settle()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Xuống' })[0]).toBeEnabled())
    expect(screen.getAllByRole('button', { name: 'Lên' })[1]).toBeEnabled()
  })
})

describe('DecksScreen: the deck list at a narrow window (QA F8)', () => {
  it('lets the list scroll sideways rather than squeezing the name column', async () => {
    // Every other column has a fixed width, so at 1024px the name was left
    // ~66px and "Otis Test Deck" wrapped to three lines under a two-line
    // header. Sized to its content like StageSpecTable, the card scrolls.
    renderScreen()
    const header = await screen.findByRole('columnheader', { name: 'Tên sàn' })
    expect(header.closest('table')).toHaveStyle({ width: 'max-content' })
  })
})

describe('DecksScreen: the quantity and unit of the works in scope (RV6-36)', () => {
  const tonnes = { quantityLabel: 'Khối lượng', unit: 'tấn' }
  const headersOf = (table: HTMLElement) =>
    within(table).getAllByRole('columnheader').map((h) => h.textContent)

  it('heads both tables with the one quantity every bays work shares', async () => {
    loadProjectModel.mockResolvedValue({
      ...MODEL,
      models: MODEL.models.map((m) => (m.work.kind === 'bays' ? { ...m, work: { ...m.work, ...tonnes } } : m)),
    })
    renderScreen()
    const rollup = await screen.findByTestId('project-rollup')
    await waitFor(() => expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument())
    expect(headersOf(rollup)).toContain('Khối lượng (tấn)')
    expect(within(rollup).getByText('4.000,00')).toBeInTheDocument()
    const list = screen.getAllByRole('table')[0] // the deck list is the first table on the page
    expect(headersOf(list)).toContain('Khối lượng (tấn)')
    expect(screen.queryByText(/m²/)).toBeNull()
  })

  it('falls back to Số lượng, per-row units and no sum when the works disagree', async () => {
    // Sơn stays m² and Tháo giáo becomes tấn. CD is in both, so its own unit is
    // undecided and its row shows the bare number; WD is only in Sơn and reads
    // m². The Σ under the table cannot add a tấn to a m² and says so.
    loadProjectModel.mockResolvedValue({
      ...MODEL,
      models: MODEL.models.map((m) => (m.work.id === 'w2' ? { ...m, work: { ...m.work, ...tonnes } } : m)),
    })
    renderScreen()
    const rollup = await screen.findByTestId('project-rollup')
    await waitFor(() => expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument())
    expect(headersOf(rollup)).toContain('Số lượng')
    expect(within(rollup).getByText('1.000,00')).toBeInTheDocument()
    expect(within(rollup).getByText('3.000,00 m²')).toBeInTheDocument()
    expect(within(rollup).queryByText('4.000,00')).toBeNull()
    const dash = within(rollup).getByText('—')
    await userEvent.hover(dash)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Các sàn dùng đơn vị khác nhau, không cộng được')
    // Both decks are in the rollup, so the deck list reads the same mix.
    expect(headersOf(screen.getAllByRole('table')[0])).toContain('Số lượng')
  })

  it('heads the rollup by the decks it lists, not by every deck of the project', async () => {
    // Seen on dev, 2026-09-15: one Kg work over every weighted deck, plus a
    // deck in no work. The deck list shows all three, so it is mixed -- Số
    // lượng, each row its own unit. The rollup hides the m² deck; every row it
    // shows is Kg, so its heading says so and its Σ adds.
    const kg = { quantityLabel: 'Khối lượng', unit: 'Kg' }
    const deckRow = (id: string, seq: number, name: string, code: string, totalAreaM2: number) => ({
      id, projectId: 'p1', seq, name, code,
      imagePath: null, imageW: null, imageH: null, drawingName: null, drawingPage: null,
      totalAreaM2, areaSource: 'guides', cellCount: 0,
    })
    loadProjectModel.mockResolvedValue({
      ...MODEL,
      models: MODEL.models.flatMap((m) => (
        m.work.id === 'w1' ? [{ ...m, work: { ...m.work, ...kg } }] : m.work.kind === 'manual' ? [m] : []
      )),
      decks: [
        ...MODEL.decks,
        {
          id: 'd3', code: 'TD', name: 'Test data', totalAreaM2: 100, seq: 3,
          imagePath: null, imageW: null, imageH: null, areaSource: 'guides' as const, cellCount: 0,
        },
      ],
    })
    listDecks.mockResolvedValue([
      deckRow('d1', 1, 'Cellar Deck', 'CD', 1000),
      deckRow('d2', 2, 'Weather Deck', 'WD', 3000),
      deckRow('d3', 3, 'Test data', 'TD', 100),
    ])
    renderScreen()
    const rollup = await screen.findByTestId('project-rollup')
    await waitFor(() => expect(within(rollup).getByText('Cellar Deck')).toBeInTheDocument())
    expect(headersOf(rollup)).toContain('Khối lượng (Kg)')
    expect(within(rollup).getByText('1.000,00')).toBeInTheDocument()
    expect(within(rollup).getByText('3.000,00')).toBeInTheDocument()
    expect(within(rollup).getByText('4.000,00')).toBeInTheDocument()
    expect(within(rollup).queryByText('—')).toBeNull()
    const list = screen.getAllByRole('table')[0]
    expect(headersOf(list)).toContain('Số lượng')
    expect(within(list).getByText('1.000,00 Kg')).toBeInTheDocument()
    expect(within(list).getByText('3.000,00 Kg')).toBeInTheDocument()
    expect(within(list).getByText('100,00 m²')).toBeInTheDocument()
  })
})
