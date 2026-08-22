import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckEditor } from './DeckEditor'

const listGuides = vi.hoisted(() => vi.fn())
const saveGuides = vi.hoisted(() => vi.fn())
const listCells = vi.hoisted(() => vi.fn())
const syncCells = vi.hoisted(() => vi.fn())
const zoneImpactOf = vi.hoisted(() => vi.fn())
const updateDeckArea = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
// The brief's original test omitted this mock even though one of its own
// tests (below) calls `listStages.mockResolvedValue(...)`. DeckEditor loads
// stages via projectsApi.listStages to resolve a stage id to a human name for
// the progress-loss warning -- without mocking the module the real
// implementation would run (hitting supabase) and `listStages` would not even
// be a defined identifier in this file, so the test referencing it could not
// have run as written.
const listStages = vi.hoisted(() => vi.fn())

vi.mock('../../lib/decksApi', () => ({
  listGuides: (d: string) => listGuides(d),
  saveGuides: (d: string, g: unknown) => saveGuides(d, g),
  listCells: (d: string) => listCells(d),
  // All three arguments, on both sides. A forwarder that drops the third one
  // makes every assertion about inheritFrom vacuous -- it would read
  // `undefined` no matter what the screen passed -- and that already
  // invalidated an assertion in this file once.
  syncCells: (d: string, c: unknown, z?: unknown) => syncCells(d, c, z),
  zoneImpactOf: (d: string, ids: string[]) => zoneImpactOf(d, ids),
  updateDeckArea: (d: string, a: number, s: string) => updateDeckArea(d, a, s),
  getDrawingUrl: (p: string) => getDrawingUrl(p),
  uploadDrawing: vi.fn(),
}))
vi.mock('../../lib/projectsApi', () => ({
  listStages: (id: string) => listStages(id),
}))
// One button per cell so a test can select a SUBSET, which "Chọn tất cả"
// cannot: a merge of some-but-not-all cells is the only shape in which the
// survivor's identity can be got wrong.
vi.mock('./DrawingCanvas', () => ({
  DrawingCanvas: ({
    cells, onCellClick,
  }: {
    cells: { code: string }[]
    onCellClick?: (code: string, additive: boolean) => void
  }) => (
    <div data-testid="canvas">
      {cells.map((c) => c.code).join(',')}
      {cells.map((c) => (
        <button key={c.code} onClick={() => onCellClick?.(c.code, true)}>
          chọn {c.code}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('../../lib/pdfToPng', () => ({
  pdfPageCount: vi.fn(), renderPdfPage: vi.fn(), imageFileToPng: vi.fn(), PDF_RENDER_WIDTH: 2000,
}))

const deck = {
  id: 'd1', projectId: 'p1', seq: 1, name: 'Main Deck', code: 'MD',
  imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
  totalAreaM2: 5258.5, areaSource: 'guides' as const, cellCount: 0,
}

/**
 * Matches a list item by its whole rendered text. The progress-loss items put
 * the cell code in a <strong>, which splits the text across elements and makes
 * the default string matcher (direct text nodes only) miss it -- while a
 * substring regex would match the mocked canvas's joined cell codes instead.
 * Comparing the item's full textContent pins the assertion on the warning list
 * and on the code/stage pairing together.
 */
const listItem = (text: string) => (_content: string, el: Element | null) =>
  el?.tagName === 'LI' && el.textContent === text

/** Two x-guides 14500mm apart and two y-guides 16000mm apart = one 232 m² bay. */
const ONE_BAY_GUIDES = [
  { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
  { id: 'g2', axis: 'x', pos: 1, offsetMm: 14500 },
  { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
  { id: 'g4', axis: 'y', pos: 1, offsetMm: 16000 },
]

beforeEach(() => {
  for (const m of [listGuides, saveGuides, listCells, syncCells, zoneImpactOf, updateDeckArea, getDrawingUrl, listStages]) m.mockReset()
  getDrawingUrl.mockResolvedValue('blob:drawing')
  listGuides.mockResolvedValue([])
  listCells.mockResolvedValue([])
  zoneImpactOf.mockResolvedValue([])
  listStages.mockResolvedValue([])
})

describe('DeckEditor', () => {
  it('turns typed mm spans into a mesh with real areas', async () => {
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Sinh lưới ô' }))

    expect(await screen.findByTestId('canvas')).toHaveTextContent('R1C1')
    // Exact match, not a /232,00/ regex: 232 m² of cells against a 5258.5 m²
    // deck also crosses the divergence threshold, and that warning's own
    // description repeats "232,00" in a longer sentence -- a substring regex
    // matches both nodes and the query becomes ambiguous. The Σ-area cell's
    // entire text is exactly "232,00", so an exact match is unambiguous and
    // still fails if the mesh area were ever wrong.
    expect(screen.getByText('232,00')).toBeInTheDocument()
  })

  it('converts a typed span into the cumulative offset the mesh is built from', async () => {
    // The arithmetic itself is table-tested in domain/geometry.test.ts. What
    // only the DOM can prove is the wiring: that antd's render(_v, _r, i) row
    // index reaches setSpan, and that the offsets come back out onto the right
    // entries of the unsorted `guides` array.
    //
    // The edited span is deliberately NOT the last one. Four x-guides at
    // cumulative 0, 1000, 2500, 6000 (spans 1000, 1500, 3500) and two y-guides
    // 2000mm apart: editing the 1500 span to 4000 must move BOTH the guide it
    // belongs to (2500 -> 5000) and the one after it (6000 -> 8500), while the
    // datum and the 1000 above it stay put. Editing the last span instead --
    // as this test originally did -- leaves nothing downstream to shift, so it
    // could not tell propagation from a single-row write.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 0.2, offsetMm: 1000 },
      { id: 'g3', axis: 'x', pos: 0.5, offsetMm: 2500 },
      { id: 'g4', axis: 'x', pos: 1, offsetMm: 6000 },
      { id: 'g5', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g6', axis: 'y', pos: 1, offsetMm: 2000 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    // Sanity check on the pre-edit state, vi-VN formatted like every other
    // number in this screen.
    expect(screen.getByText('1.000')).toBeInTheDocument()
    expect(screen.getByText('2.500')).toBeInTheDocument()
    expect(screen.getByText('6.000')).toBeInTheDocument()

    // Row 3's span input shows 1500 (2500 - 1000); it is the only field on the
    // page with that value, so it can be located by display value the same
    // way StageConfigPanel's tests locate its weight InputNumber cells.
    const editedSpan = screen.getByDisplayValue('1500')
    await userEvent.clear(editedSpan)
    await userEvent.type(editedSpan, '4000')

    await waitFor(() => expect(screen.getByText('5.000')).toBeInTheDocument())
    // The guide AFTER the edited one moves by the same +2500. This is the
    // assertion the old version of this test could not make.
    expect(screen.getByText('8.500')).toBeInTheDocument()
    expect(screen.queryByText('6.000')).toBeNull()
    // Upstream is untouched, and the old cumulative value is gone.
    expect(screen.getByText('1.000')).toBeInTheDocument()
    expect(screen.queryByText('2.500')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    // New x-offsets are (0, 1000, 5000, 8500); y-offsets are (0, 2000). Three
    // bays: 2 m², 8 m² and 7 m², summing to 17.
    expect(await screen.findByTestId('canvas')).toHaveTextContent('R1C1,R1C2,R1C3')
    // Exact match, not a regex: the divergence banner's own description also
    // repeats "17,00" inside a longer sentence, same ambiguity as the first test.
    expect(screen.getByText('17,00')).toBeInTheDocument()
  })

  it('deletes the guide the admin clicked, by its index into the unsorted list', async () => {
    // The rows are sorted by pos; `guides` is not. These three x-guides are
    // deliberately stored out of order, so the middle ROW is guides[2]. Deleting
    // by the rendered position instead would remove guides[1] -- the 2500mm
    // guide -- and the admin would watch a different line vanish than the one
    // they aimed at.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 2500 },
      { id: 'g3', axis: 'x', pos: 0.4, offsetMm: 1000 },
      { id: 'g4', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g5', axis: 'y', pos: 1, offsetMm: 7000 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    const xTable = screen.getByText('Guide dọc (cột)').closest('.ant-table-wrapper') as HTMLElement
    const removeButtons = within(xTable).getAllByRole('button', { name: 'Xoá' })
    expect(removeButtons).toHaveLength(3)
    await userEvent.click(removeButtons[1])

    // Two guides left, and they are the datum and the 2500mm one.
    expect(within(xTable).getAllByRole('button', { name: 'Xoá' })).toHaveLength(2)
    expect(screen.queryByText('1.000')).toBeNull()
    expect(screen.getByText('2.500')).toBeInTheDocument()

    // And the mesh proves WHICH guide went: one bay of 2500 x 7000 = 17.5 m².
    // Deleting the wrong x-guide leaves 1000 x 7000 = 7 m² instead.
    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    expect(await screen.findByTestId('canvas')).toHaveTextContent('R1C1')
    expect(screen.getByText('17,50')).toBeInTheDocument()
  })

  it('warns when the cell areas diverge from the deck total beyond 5%', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    // 100 m² of cells against a 5258.5 m² deck is far beyond the threshold.
    // The warning's message and description are separate DOM nodes and both
    // contain the word "lệch", so a singular findByText is ambiguous here;
    // findAllByText plus a non-empty check still fails if the banner never
    // renders at all.
    expect((await screen.findAllByText(/lệch/i)).length).toBeGreaterThan(0)
    // vi-VN throughout: a dot would read as a thousands separator here.
    expect(screen.getByText(/lệch 98,1%/)).toBeInTheDocument()
  })

  it('does not warn when the areas agree', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 5258.5, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')
    expect(screen.queryByText(/lệch/i)).toBeNull()
  })

  it('does not warn on a deck that has no cells yet', async () => {
    // An empty cell set diverges from any declared area by exactly 100%, so
    // without a guard every untouched deck greets the admin with a warning
    // about work they have not done yet -- and a banner that is always on is
    // a banner nobody reads.
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')
    expect(screen.queryByText(/lệch/i)).toBeNull()
  })

  it('pro-rates and records estimates when only one axis carries real spans', async () => {
    // x has a real chain, y does not. A cell's area is spanX x spanY, so every
    // cell still measures 0 m² -- treating that as "measured from guides" would
    // publish zeroes as fact. Both axes or neither.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 14500 },
      { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g4', axis: 'y', pos: 1, offsetMm: 0 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))

    expect(await screen.findByText(/không phải đo thật/)).toBeInTheDocument()
    // The single bay absorbs the whole declared deck area, pro-rated.
    expect(screen.getByText('5.258,50')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Lưu guide và diện tích' }))
    await waitFor(() => expect(updateDeckArea).toHaveBeenCalledWith('d1', 5258.5, 'prorated'))
  })

  it('reads a comma-decimal deck area the way a Vietnamese admin types it', async () => {
    // The denominator of every percentage on the project. Without
    // decimalSeparator="," antd truncates "1234,5" to 1234 and the deck loses
    // half a square metre with nothing on screen to show it happened.
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    // No guides in this test, so the deck-area field is the only spin button.
    const areaInput = screen.getByRole('spinbutton')
    await userEvent.clear(areaInput)
    await userEvent.type(areaInput, '1234,5')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu guide và diện tích' }))

    await waitFor(() => expect(updateDeckArea).toHaveBeenCalledWith('d1', 1234.5, 'prorated'))
  })

  it('saves a generated mesh that needed no delete and no merge', async () => {
    // The defect this covers: syncCells' predecessor was reachable only from a
    // delete or a merge, so a deck whose outline came out right first time
    // could never persist its cells at all -- while "Lưu guide và diện tích"
    // happily wrote new offsets and a new area_source next to the old areas.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu lưới ô' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells).toHaveBeenCalledWith(
      'd1',
      [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232 }],
      {},
    )
  })

  it('gates the mesh save behind the warning when it would drop a ticked cell', async () => {
    // A regenerated mesh reuses R1C1, R1C2, ... so its codes collide with
    // persisted cells -- and any persisted code the new mesh does NOT contain
    // is a cell about to be deleted, taking its recorded progress with it.
    // Saving the mesh without this gate would discard it silently.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    listCells.mockResolvedValue([
      { id: 'c9', code: 'R9C9', x: 0, y: 0, w: 1, h: 1, areaM2: 300, stageId: 'coat1' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.2 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu lưới ô' }))

    expect(await screen.findByText(listItem('R9C9 — Coat 1'))).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()

    // Confirming goes through, and the mesh -- not the old cell -- is what
    // gets written.
    syncCells.mockResolvedValue(undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([
      { code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232 },
    ])
  })

  it('names the affected zones before deleting a cell', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    zoneImpactOf.mockResolvedValue([
      { zoneId: 'z1', zoneName: 'Zone 3', cellCodes: ['R1C1'] },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Xoá ô đã chọn' }))

    // zone_cells cascades on cell_id, so deleting silently shrinks the zone.
    expect(await screen.findByText(/Zone 3/)).toBeInTheDocument()
    // There IS zone impact here, so the dialog may say so.
    expect(screen.getByText('Xoá ô sẽ ảnh hưởng zone')).toBeInTheDocument()
    expect(screen.getByText(/Các ô này đang thuộc zone/)).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('applies the delete once the zone warning is confirmed', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    zoneImpactOf.mockResolvedValue([{ zoneId: 'z1', zoneName: 'Zone 3', cellCodes: ['R1C1'] }])
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Xoá ô đã chọn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn xoá' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([])
  })

  it('tells syncCells which sources a merged cell inherits zones from', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    // Spec 8.3: without this the survivor silently drops out of both zones.
    expect(syncCells.mock.calls[0][2]).toEqual({ R1C1: ['R1C1', 'R1C2'] })
  })

  it('names the cells whose recorded progress a merge would discard', async () => {
    // syncCells updates the SURVIVOR's row in place, so its stage survives; any
    // other merge source is deleted and its progress goes with it. There is no
    // honest carry rule -- taking the furthest-along stage over-reports the
    // merged bay, taking the least under-reports it -- so the admin has to be
    // told which ticks they are about to lose, by cell and by stage, and decide.
    //
    // BOTH sources carry a stage on purpose. With only one of them ticked, the
    // survivor clause in the progress-loss filter could be deleted outright and
    // this test would still pass, proving nothing about a mis-identified
    // survivor -- which is the failure mode that matters.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: 'coat1' },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.15 },
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    // R1C1 is the top-left source, so mergeCells keeps its code and syncCells
    // keeps its row: it is the survivor and its Coat 1 is NOT lost.
    expect(await screen.findByText(listItem('R1C2 — Coat 3'))).toBeInTheDocument()
    expect(screen.queryByText(listItem('R1C1 — Coat 1'))).toBeNull()
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('keeps the survivor out of the loss list when only some cells are merged', async () => {
    // A partial selection: the merged pair lands AFTER the untouched cell in
    // the new array, so anything that identifies the survivor by position
    // rather than by the merge result names the wrong cell -- and a
    // mis-identified survivor either warns about progress that is not lost or,
    // worse, stays quiet about progress that is.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.25, h: 1, areaM2: 50, stageId: 'coat1' },
      { id: 'c2', code: 'R1C2', x: 0.25, y: 0, w: 0.25, h: 1, areaM2: 50, stageId: 'coat3' },
      { id: 'c3', code: 'R1C3', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: 'coat2' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.15 },
      { id: 'coat2', seq: 2, name: 'Coat 2', color: '#faad14', weight: 0.2 },
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'chọn R1C1' }))
    await userEvent.click(screen.getByRole('button', { name: 'chọn R1C2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    expect(await screen.findByText(listItem('R1C2 — Coat 3'))).toBeInTheDocument()
    expect(screen.queryByText(listItem('R1C1 — Coat 1'))).toBeNull()
    // R1C3 was never selected, so its progress is not at risk at all.
    expect(screen.queryByText(listItem('R1C3 — Coat 2'))).toBeNull()
  })

  it('does not claim zone impact when the only cost is recorded progress', async () => {
    // zoneImpactOf returns nothing here, so the dialog opens on progress loss
    // alone. Saying "these cells belong to a zone" then would be false, and a
    // disclosure dialog that overstates is one the admin learns to skim.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    expect(await screen.findByText('Gộp ô sẽ làm mất tiến độ đã ghi')).toBeInTheDocument()
    expect(screen.getByText(/Không có zone nào bị ảnh hưởng/)).toBeInTheDocument()
    expect(screen.queryByText(/Các ô này đang thuộc zone/)).toBeNull()
  })

  it('does not warn about progress when no source carries any', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    // Nothing to lose, so the merge applies without an extra confirmation.
    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
  })

  it('refuses to merge a non-rectangular selection, in Vietnamese', async () => {
    // geometry.ts throws in English and stays that way. Selecting an L-shape is
    // routine, not an infrastructure failure, so the admin must not be shown
    // the domain's own wording.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 0.5, areaM2: 10, stageId: null },
      { id: 'c2', code: 'R2C2', x: 0.5, y: 0.5, w: 0.5, h: 0.5, areaM2: 10, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    expect(await screen.findByText(/hình chữ nhật kín/)).toBeInTheDocument()
    expect(screen.queryByText(/solid rectangle/i)).toBeNull()
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('refuses to merge overlapping cells, in Vietnamese', async () => {
    // A second marker, so the translation cannot be a single hard-coded string
    // that happens to sit on the one path a test exercises.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.6, h: 1, areaM2: 120, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    expect(await screen.findByText(/bị trùng nhau/)).toBeInTheDocument()
    expect(screen.queryByText(/overlapping cells/i)).toBeNull()
  })

  it('surfaces an infrastructure error unchanged rather than swallowing it', async () => {
    // The fallback in the translator is the original message, so a failure it
    // has never heard of still reaches the admin instead of vanishing.
    listCells.mockRejectedValue(new Error('JWT expired'))
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    expect(await screen.findByText('JWT expired')).toBeInTheDocument()
  })
})
