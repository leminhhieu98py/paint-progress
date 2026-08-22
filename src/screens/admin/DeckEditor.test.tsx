import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckEditor } from './DeckEditor'

const listGuides = vi.hoisted(() => vi.fn())
const saveGuides = vi.hoisted(() => vi.fn())
const listCells = vi.hoisted(() => vi.fn())
const replaceCells = vi.hoisted(() => vi.fn())
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
  replaceCells: (d: string, c: unknown, z?: unknown) => replaceCells(d, c, z),
  zoneImpactOf: (d: string, ids: string[]) => zoneImpactOf(d, ids),
  updateDeckArea: (d: string, a: number, s: string) => updateDeckArea(d, a, s),
  getDrawingUrl: (p: string) => getDrawingUrl(p),
  uploadDrawing: vi.fn(),
}))
vi.mock('../../lib/projectsApi', () => ({
  listStages: (id: string) => listStages(id),
}))
vi.mock('./DrawingCanvas', () => ({
  DrawingCanvas: ({ cells }: { cells: { code: string }[] }) => (
    <div data-testid="canvas">{cells.map((c) => c.code).join(',')}</div>
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

beforeEach(() => {
  for (const m of [listGuides, saveGuides, listCells, replaceCells, zoneImpactOf, updateDeckArea, getDrawingUrl, listStages]) m.mockReset()
  getDrawingUrl.mockResolvedValue('blob:drawing')
  listGuides.mockResolvedValue([])
  listCells.mockResolvedValue([])
  zoneImpactOf.mockResolvedValue([])
  listStages.mockResolvedValue([])
})

describe('DeckEditor', () => {
  it('turns typed mm spans into a mesh with real areas', async () => {
    // Two x-guides 14500mm apart and two y-guides 16000mm apart = 232 m².
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 14500 },
      { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g4', axis: 'y', pos: 1, offsetMm: 16000 },
    ])
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
    // Extra coverage beyond the brief: the brief's first test only proves that
    // pre-loaded (already-cumulative) offsets produce the right area -- it never
    // exercises the admin actually typing a span into the UI. That conversion is
    // called out as the most error-prone part of this task, so it needs its own
    // proof: three x-guides at spans 1000mm and 1500mm (cumulative 0, 1000, 2500),
    // two y-guides 2000mm apart. Editing the second span from 1500 to 4000mm must
    // shift that guide's cumulative offset to 5000mm (1000 + 4000), not overwrite
    // the origin or the first guide, and the generated mesh area must follow.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 0.4, offsetMm: 1000 },
      { id: 'g3', axis: 'x', pos: 1, offsetMm: 2500 },
      { id: 'g4', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g5', axis: 'y', pos: 1, offsetMm: 2000 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    // Sanity check on the pre-edit state: row 1's span (1000) and row 2's
    // cumulative offset (2500) are both on screen before anything is typed.
    expect(screen.getByText('1000')).toBeInTheDocument()
    expect(screen.getByText('2500')).toBeInTheDocument()

    // Row 2's span input shows 1500 (2500 - 1000); it is the only field on the
    // page with that value, so it can be located by display value the same
    // way StageConfigPanel's tests locate its weight InputNumber cells.
    const editedSpan = screen.getByDisplayValue('1500')
    await userEvent.clear(editedSpan)
    await userEvent.type(editedSpan, '4000')

    // The cumulative offset must become 1000 + 4000 = 5000, shown in the
    // "Toạ độ thật (mm)" column, and the origin/first span must be untouched.
    await waitFor(() => expect(screen.getByText('5000')).toBeInTheDocument())
    expect(screen.getByText('1000')).toBeInTheDocument()
    expect(screen.queryByText('2500')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    // New x-offsets are (0, 1000, 5000); y-offsets are (0, 2000). Two bays:
    // (1000-0)*2000/1e6 = 2 m² and (5000-1000)*2000/1e6 = 8 m², summing to 10.
    expect(await screen.findByTestId('canvas')).toHaveTextContent('R1C1,R1C2')
    // Exact match, not a regex: the divergence banner's own description also
    // repeats "10,00" inside a longer sentence, same ambiguity as the first test.
    expect(screen.getByText('10,00')).toBeInTheDocument()
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
  })

  it('does not warn when the areas agree', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 5258.5, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')
    expect(screen.queryByText(/lệch/i)).toBeNull()
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
    expect(replaceCells).not.toHaveBeenCalled()
  })

  it('applies the delete once the zone warning is confirmed', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    zoneImpactOf.mockResolvedValue([{ zoneId: 'z1', zoneName: 'Zone 3', cellCodes: ['R1C1'] }])
    replaceCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Xoá ô đã chọn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn xoá' }))

    await waitFor(() => expect(replaceCells).toHaveBeenCalledTimes(1))
    expect(replaceCells.mock.calls[0][1]).toEqual([])
  })

  it('tells replaceCells which sources a merged cell inherits zones from', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    replaceCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    await waitFor(() => expect(replaceCells).toHaveBeenCalledTimes(1))
    // Spec 8.3: without this the survivor silently drops out of both zones.
    expect(replaceCells.mock.calls[0][2]).toEqual({ R1C1: ['R1C1', 'R1C2'] })
  })

  it('names the cells whose recorded progress a merge would discard', async () => {
    // replaceCells carries the SURVIVOR's stage forward but discards progress on
    // any other merge source, and there is no honest carry rule: taking the
    // furthest-along stage over-reports the merged bay, taking the least
    // under-reports it. So the admin has to be told which ticks they are about
    // to lose, by cell and by stage, and decide.
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

    // Exact match, not a /R1C2/ regex: the mocked DrawingCanvas renders every
    // cell code joined as "R1C1,R1C2" in one node, which a substring regex
    // also matches. The progress-loss list item's own text is exactly "R1C2",
    // so an exact match lands on the warning specifically.
    expect(await screen.findByText('R1C2')).toBeInTheDocument()
    expect(screen.getByText(/Coat 3/)).toBeInTheDocument()
    expect(replaceCells).not.toHaveBeenCalled()
  })

  it('does not warn about progress when no source carries any', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    replaceCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    // Nothing to lose, so the merge applies without an extra confirmation.
    await waitFor(() => expect(replaceCells).toHaveBeenCalledTimes(1))
  })

  it('refuses to merge a non-rectangular selection with the reason', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 0.5, areaM2: 10, stageId: null },
      { id: 'c2', code: 'R2C2', x: 0.5, y: 0.5, w: 0.5, h: 0.5, areaM2: 10, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    expect(await screen.findByText(/solid rectangle/i)).toBeInTheDocument()
    expect(replaceCells).not.toHaveBeenCalled()
  })
})
