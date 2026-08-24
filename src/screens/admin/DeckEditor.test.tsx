import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inkProfile } from '../../domain/gridDetect'
import { DeckEditor, mergeErrorInVietnamese } from './DeckEditor'

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
const inkProfileFromImage = vi.hoisted(() => vi.fn())

vi.mock('../../canvas/inkProfileFromImage', () => ({
  inkProfileFromImage: (url: string, options?: unknown) => inkProfileFromImage(url, options),
}))
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
vi.mock('../../canvas/DrawingCanvas', () => ({
  DrawingCanvas: ({
    cells, guides, onCellClick, onGuideMove, onGuideAdd, cellColors, cropRect, onCropDraw, onGuideClick,
  }: {
    cells: { code: string }[]
    guides: { id: string; axis: 'x' | 'y'; pos: number; offsetMm: number }[]
    onCellClick?: (code: string, additive: boolean) => void
    onGuideMove?: (index: number, pos: number) => void
    onGuideAdd?: (axis: 'x' | 'y', pos: number) => void
    cellColors?: Record<string, string>
    cropRect?: { x: number; y: number; w: number; h: number } | null
    onCropDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
    onGuideClick?: (index: number) => void
  }) => (
    <div data-testid="canvas">
      {/*
        Whether the canvas was put in crop mode is observable ONLY as this
        button's presence: `onCropDraw` is what puts the real canvas in the
        mode, so a stand-in that always rendered the button could not tell a
        screen that entered crop mode from one that never left it.
      */}
      {onCropDraw && (
        <button onClick={() => onCropDraw({ x: 0.1, y: 0.1, w: 0.4, h: 0.5 })}>kéo khung sàn</button>
      )}
      {/* A second, different drag: re-cropping has to replace the box, not add to it. */}
      {onCropDraw && (
        <button onClick={() => onCropDraw({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 })}>kéo khung sàn nhỏ</button>
      )}
      {/*
        Present only when guide-clicking is armed, for the same reason as the
        crop button above: the mode is observable ONLY as this button existing.
      */}
      {onGuideClick && guides.map((_g, i) => (
        <button key={`del-${i}`} onClick={() => onGuideClick(i)}>bấm xoá đường {i}</button>
      ))}
      <div data-testid="crop">{cropRect ? JSON.stringify(cropRect) : ''}</div>
      {cells.map((c) => c.code).join(',')}
      {cells.map((c) => (
        <button key={c.code} data-color={cellColors?.[c.code] ?? ''} onClick={() => onCellClick?.(c.code, true)}>
          chọn {c.code}
        </button>
      ))}
      {/*
        The screen never renders a guide's raw pos anywhere -- only mm derived
        from it -- so re-rail tests (which assert exact POSITIONS, not just
        "moved") have nothing else to read. Exact array order and shape as
        passed to DrawingCanvas, so a test can index it the same way the
        fixture below built `guides`.
      */}
      <div data-testid="guides">{JSON.stringify(guides)}</div>
      {/*
        One drag per guide, all to the same far-right target, standing in for
        the real Konva drag. 0.99 is past every interior guide in the fixtures
        below, which is the whole point: a drag that crosses a neighbour is the
        case that used to produce a negative mm span.
      */}
      {guides.map((_g, i) => (
        <button key={`drag-${i}`} onClick={() => onGuideMove?.(i, 0.99)}>
          kéo guide {i}
        </button>
      ))}
      {/*
        Two more fixed targets, standing in for a drag that lands short of the
        far edge -- 0.99 above only ever exercises "past every neighbour",
        which cannot tell a re-rail test whether interior guides landed on the
        right RATIO rather than merely "somewhere that increased".
      */}
      {guides.map((_g, i) => (
        <button key={`drag80-${i}`} onClick={() => onGuideMove?.(i, 0.8)}>
          kéo guide {i} tới 0.8
        </button>
      ))}
      {guides.map((_g, i) => (
        <button key={`drag20-${i}`} onClick={() => onGuideMove?.(i, 0.2)}>
          kéo guide {i} tới 0.2
        </button>
      ))}
      {/* Stands in for a double-click adding a guide midway across the axis. */}
      <button onClick={() => onGuideAdd?.('x', 0.5)}>thêm guide x giữa</button>
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
  for (const m of [
    listGuides, saveGuides, listCells, syncCells, zoneImpactOf, updateDeckArea, getDrawingUrl, listStages,
    inkProfileFromImage,
  ]) m.mockReset()
  getDrawingUrl.mockResolvedValue('blob:drawing')
  listGuides.mockResolvedValue([])
  listCells.mockResolvedValue([])
  zoneImpactOf.mockResolvedValue([])
  listStages.mockResolvedValue([])
})

/**
 * A hand-built InkProfile, run through the REAL `inkProfile`, standing in
 * for `inkProfileFromImage`'s (mocked, since jsdom has no canvas) expensive
 * pass. Three vertical lines (columns 2/10/16) and three horizontal lines
 * (rows 3/9/15), each painted for a different number of rows/columns so they
 * cross the sliders' three interesting fractions -- 0.30 (Home), 0.60
 * (default), 0.90 (End) -- at different points:
 *
 *   column/row ink   |  candidate at fraction
 *   2 / 3   (19/19)  |  0.30, 0.60, 0.90 (always)
 *   10 / 9  (13/19)  |  0.30, 0.60
 *   16 / 15 ( 7/19)  |  0.30 only
 *
 * so moving either slider to its default/min/max changes that axis' guide
 * count (2 / 3 / 1) while leaving the other axis untouched -- which is the
 * one thing this whole feature exists to prove. Each line's own span fully
 * contains where the perpendicular lines cross it, so nothing here picks up
 * stray ink from the other axis' lines; every other column/row in the image
 * carries at most 3 stray ink pixels, far under the lowest threshold (5.7).
 */
function fixtureProfile() {
  const width = 20
  const height = 20
  const rgb = new Uint8Array(width * height * 3).fill(255)
  const paint = (x: number, y: number) => {
    const o = (y * width + x) * 3
    rgb[o] = 0
    rgb[o + 1] = 0
    rgb[o + 2] = 0
  }
  const fillColumn = (x: number, yFrom: number, yTo: number) => {
    for (let y = yFrom; y <= yTo; y++) paint(x, y)
  }
  const fillRow = (y: number, xFrom: number, xTo: number) => {
    for (let x = xFrom; x <= xTo; x++) paint(x, y)
  }
  fillColumn(2, 0, 18)
  fillColumn(10, 0, 12)
  fillColumn(16, 0, 6)
  fillRow(3, 0, 18)
  fillRow(9, 0, 12)
  fillRow(15, 0, 6)
  return inkProfile(rgb, width, height)
}

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

  it('passes each cell its recorded stage colour, and nothing for a cell with no stage', async () => {
    // DrawingCanvas's own fill/opacity logic for cellColors is covered at the
    // component level (DrawingCanvas.test.tsx, Task 7); what only this screen
    // can prove is that DeckEditor actually computes and forwards the map --
    // `cellColors` was previously never passed at all, so every cell rendered
    // plain regardless of recorded progress.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: 'coat1' },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    listStages.mockResolvedValue([
      { id: 'coat1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.2 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    expect(screen.getByRole('button', { name: 'chọn R1C1' })).toHaveAttribute('data-color', '#1677ff')
    expect(screen.getByRole('button', { name: 'chọn R1C2' })).toHaveAttribute('data-color', '')
  })

  it('converts a typed span into the cumulative offset the mesh is built from', async () => {
    // The arithmetic itself is table-tested in domain/geometry.test.ts. What
    // only the DOM can prove is the wiring: that antd's render(_v, _r, i) row
    // index reaches setSpan, and that the offsets come back out onto the right
    // entries of the UNSORTED `guides` array -- which this fixture must
    // actually exercise, or the wiring bug it is meant to catch has nowhere to
    // hide.
    //
    // An admin draws the two outer verticals, then the middle one: `guides`
    // holds x@pos0.0, x@pos1.0, x@pos0.5 in THAT order (guides-index 0, 1, 2),
    // while the sorted table order is x@pos0.0, x@pos0.5, x@pos1.0 (sorted
    // position 0, 1, 2). From the second row on, sorted position and
    // guides-index disagree -- a fixture with guides already stored in `pos`
    // order (as this test previously used) cannot tell a write-back keyed by
    // guides-index from one keyed by sorted position, because the two never
    // differ. Editing the middle span, sorted position 1 / guides-index 2,
    // is where they first do.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 26500 },
      { id: 'g3', axis: 'x', pos: 0.5, offsetMm: 12000 },
      { id: 'g4', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g5', axis: 'y', pos: 1, offsetMm: 16000 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    // Sanity check on the pre-edit state, vi-VN formatted like every other
    // number in this screen.
    expect(screen.getByText('12.000')).toBeInTheDocument()
    expect(screen.getByText('26.500')).toBeInTheDocument()

    // The middle row's span input shows 12000; it is the only field on the
    // page with that value, so it can be located by display value the same
    // way StageConfigPanel's tests locate its weight InputNumber cells.
    const editedSpan = screen.getByDisplayValue('12000')
    await userEvent.clear(editedSpan)
    await userEvent.type(editedSpan, '12500')

    await waitFor(() => expect(screen.getByText('12.500')).toBeInTheDocument())
    // The guide after the edited one (sorted position 2, guides-index 1)
    // moves by the same +500. A write-back keyed by sorted position instead
    // would write 12500 and 27000 onto guides-index 1 and 2 respectively --
    // the reverse of the correct assignment -- which the per-row offsets
    // alone cannot expose (both values would still appear somewhere in the
    // table either way). Only the mesh built from them can.
    expect(screen.getByText('27.000')).toBeInTheDocument()
    expect(screen.queryByText('26.500')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    // Two bays: 12500mm x 16000mm = 200 m², and 14500mm x 16000mm = 232 m²,
    // summing to 432. Swap the guides-index 1 and 2 write targets and the
    // split becomes 27000mm x 16000mm = 432 m² plus 14500mm x 16000mm = 232
    // m², summing to 664 instead -- a different total, not just a relabeled
    // one, so this assertion fails under that mutation.
    expect(await screen.findByTestId('canvas')).toHaveTextContent('R1C1,R1C2')
    expect(screen.getByText('432,00')).toBeInTheDocument()
  })

  it('reads back a half-millimetre span in the real-coordinate column', async () => {
    // C6. B8 made the span field accept "14500,5" -- offset_mm is numeric(12,2)
    // -- but this column rendered through formatMm at maximumFractionDigits 0,
    // so the typed half-millimetre came back as "14.501". No number was wrong;
    // the areas use the raw value. The admin simply could not read back what
    // they had entered, on the one column that exists to be checked against the
    // printed drawing.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 14500 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    // Whole millimetres, which is nearly every offset, stay unpadded: this is
    // what minimumFractionDigits 0 buys, and it fails if the column is simply
    // pinned to two digits.
    expect(screen.getByText('14.500')).toBeInTheDocument()

    const span = screen.getByDisplayValue('14500')
    await userEvent.clear(span)
    // Comma decimal, as a Vietnamese admin types it.
    await userEvent.type(span, '14500,5')

    // vi-VN: dot groups thousands, comma is the decimal separator.
    expect(await screen.findByText('14.500,5')).toBeInTheDocument()
    expect(screen.queryByText('14.501')).toBeNull()
  })

  it('propagates an edited y-axis span onto the y-guides, not onto whatever sits at that sorted position', async () => {
    // Mirrors the case above on the axis the review found does the most
    // damage: the y-guides here live at guides-index 2, 3, 4 -- three slots
    // after the two x-guides -- so a write-back keyed by sorted position (0,
    // 1, 2) instead of guides-index lands on guides-index 0, 1 and 2, i.e. on
    // BOTH x-guides and the y-datum, while the y span the admin actually typed
    // is left completely unchanged.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 9000 },
      { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g4', axis: 'y', pos: 1, offsetMm: 26500 },
      { id: 'g5', axis: 'y', pos: 0.5, offsetMm: 12000 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    expect(screen.getByText('9.000')).toBeInTheDocument()
    expect(screen.getByText('12.000')).toBeInTheDocument()
    expect(screen.getByText('26.500')).toBeInTheDocument()

    const editedSpan = screen.getByDisplayValue('12000')
    await userEvent.clear(editedSpan)
    await userEvent.type(editedSpan, '12500')

    await waitFor(() => expect(screen.getByText('12.500')).toBeInTheDocument())
    expect(screen.getByText('27.000')).toBeInTheDocument()
    expect(screen.queryByText('26.500')).toBeNull()
    // A y-axis edit must not touch the x-guide.
    expect(screen.getByText('9.000')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    // One column (9000mm), two rows (12500mm, 14500mm): 112.5 m² + 130.5 m² =
    // 243. A write-back keyed by sorted position instead corrupts the x span
    // and leaves the y offsets exactly as they were before the edit, turning
    // the mesh into 368,75 -- a different total, so this assertion fails
    // under that mutation even though nothing about it looks "swapped".
    expect(await screen.findByTestId('canvas')).toHaveTextContent('R1C1,R2C1')
    expect(screen.getByText('243,00')).toBeInTheDocument()
  })

  it('reads a comma-decimal guide span the way a Vietnamese admin types it', async () => {
    // The deck-area and stage-weight fields both carry decimalSeparator=","
    // with a comment about this exact bug; the guide-span field was the one
    // numeric input in this screen missing it. Proven through the generated
    // mesh's area rather than the field's own display value: clearing an
    // antd InputNumber with min={0} briefly reports 0 before the typed
    // characters land, so a literal display-value assertion here would be
    // pinned on that transient artifact rather than on the parsed number
    // that actually reaches state.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    const span = screen.getByDisplayValue('14500')
    await userEvent.clear(span)
    await userEvent.type(span, '14500,5')
    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))

    // 14500.5mm x 16000mm = 232.008 m², rendered 232,01. Without
    // decimalSeparator="," antd truncates the typed span to 14500 and this
    // reads 232,00 instead -- the lost half-millimetre has nowhere left to
    // show up once that happens.
    expect(await screen.findByText('232,01')).toBeInTheDocument()
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

  it('gives a newly added guide an offset interpolated between its neighbours, not a bare 0', async () => {
    // ONE_BAY_GUIDES: x at pos 0 (0mm) and pos 1 (14500mm). Adding a guide at
    // pos 0.5 with the old offsetMm: 0 would sort AFTER the pos-0 guide but
    // BEFORE the pos-1 guide in mm terms too (0 < 14500), so this fixture
    // alone would not expose the old bug -- the interpolated midpoint
    // (7250mm) is what proves the wiring reached DeckEditor at all, since 0
    // happens to also be "monotonic" against a datum of 0.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'thêm guide x giữa' }))

    // (0 + 14500) / 2 = 7250mm, vi-VN grouped.
    expect(await screen.findByText('7.250')).toBeInTheDocument()
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
    // "thiếu" because the cells (100 m²) under-cover the declared 5258.5 m².
    expect(screen.getByText(/thiếu 98,10%/)).toBeInTheDocument()
  })

  it('warns on over-coverage too, naming it "vượt" -- not just under-coverage', async () => {
    // Regression guard: `diverges` must stay on the absolute-value helper
    // (divergesBeyondThreshold), not a signed `areaDivergence(...) >
    // THRESHOLD` comparison. Cells summing to 6000 m² against a declared
    // 5258.5 m² deck is over-coverage (a negative divergence), which a signed
    // `>` comparison against a positive threshold would silently pass as
    // "within tolerance" -- geometry.test.ts already proves the helper itself
    // is bidirectional; this pins that DeckEditor actually calls it instead
    // of re-deriving the comparison from the signed value.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 6000, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    expect(await screen.findByText(/vượt 14,10%/)).toBeInTheDocument()
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

  it('refuses to generate an empty mesh instead of silently wiping the cell set', async () => {
    // Fewer than 2 guides on the y axis: buildMeshFromGuides returns [] for
    // this shape. Replacing generateMesh's `if (mesh.length === 0)` guard
    // with `if (false)` leaves every OTHER DeckEditor test green -- none of
    // them exercises an axis with under 2 guides -- while in real use it
    // would silently set `cells` to [] with no error at all, and the next
    // save wipes the deck's whole geometry.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 14500 },
      { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
    ])
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))

    expect(await screen.findByText(/Cần ít nhất 2 đường guide/)).toBeInTheDocument()
    // The cell that was already on screen must survive: silently emptying
    // `cells` here is exactly the defect this guard exists to prevent.
    expect(screen.getByTestId('canvas')).toHaveTextContent('R1C1')
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

    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    // 'guides' because that is what the deck already records and no mesh was
    // regenerated here: the provenance travels with the cell set, so typing in
    // the area field cannot relabel areas it did not compute.
    await waitFor(() => expect(updateDeckArea).toHaveBeenCalledWith('d1', 1234.5, 'guides'))
  })

  it('saves a generated mesh that needed no delete and no merge', async () => {
    // The defect this covers: syncCells' predecessor was reachable only from a
    // delete or a merge, so a deck whose outline came out right first time
    // could never persist its cells at all -- while the separate
    // guides-and-area button happily wrote new offsets and a new area_source
    // next to the old areas. Both are one action now, so this also pins that
    // collapsing them did not lose the cell write.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells).toHaveBeenCalledWith(
      'd1',
      [{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232 }],
      {},
    )
  })

  it('sends every untouched guide back under the id it was loaded with', async () => {
    // C3. saveGuides diffs on the guide id, so the ids have to survive the round
    // trip through this screen's state. They were stripped on load and
    // re-invented as array indices on the way into buildMeshFromGuides, which
    // left saveGuides nothing to diff on -- so it deleted every guide for the
    // deck and re-inserted them, and a failed insert on a site tether took the
    // deck's whole mm chain with it.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    await waitFor(() => expect(saveGuides).toHaveBeenCalledTimes(1))
    expect(saveGuides.mock.calls[0][1]).toEqual(ONE_BAY_GUIDES)
  })

  it('mints a real uuid for a guide the admin adds, so it is an insert of a known row', async () => {
    // The other half: a guide that has no database row yet still needs an
    // identity before the write, because the write is an upsert keyed on it.
    // Index-shaped ids would collide with nothing and match nothing.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'thêm guide x giữa' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    await waitFor(() => expect(saveGuides).toHaveBeenCalledTimes(1))
    const saved = saveGuides.mock.calls[0][1] as { id: string }[]
    expect(saved).toHaveLength(5)
    // The four loaded guides keep their own ids, in order, and the new one
    // carries a v4 uuid rather than an array index.
    expect(saved.slice(0, 4).map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4'])
    expect(saved[4].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
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
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    expect(await screen.findByText(listItem('R9C9 — Coat 1'))).toBeInTheDocument()
    // The merge-only caveat is about a merge's missing honest carry rule; a
    // mesh save has no survivor at all, so it must not appear here.
    expect(screen.queryByText(/Ô sống sót giữ tiến độ/)).toBeNull()
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

  it('disables the delete and merge buttons while a review is in flight, so a double-tap cannot fire two passes', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100, stageId: null },
    ])
    let resolveZoneImpact: (v: unknown[]) => void = () => {}
    zoneImpactOf.mockImplementation(
      () => new Promise((resolve) => { resolveZoneImpact = resolve }),
    )
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    const deleteButton = screen.getByRole('button', { name: 'Xoá ô đã chọn' })
    await userEvent.click(deleteButton)

    // beginEdit is awaiting zoneImpactOf -- the whole review is still in
    // flight, and RTL's userEvent will not dispatch a click on a genuinely
    // disabled button, so a second tap landing here is exactly what the
    // disabled state prevents.
    expect(deleteButton).toBeDisabled()
    // The initial load's listCells, plus reviewEdit's own re-read: a second
    // tap reaching beginEdit again would add a third call here.
    expect(listCells).toHaveBeenCalledTimes(2)
    await userEvent.click(deleteButton)
    expect(listCells).toHaveBeenCalledTimes(2)

    resolveZoneImpact([])
    await waitFor(() => expect(deleteButton).not.toBeDisabled())
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
    // There IS zone impact here, so the dialog may say so. The title no
    // longer names the operation (delete/merge/mesh) -- it only ever
    // distinguishes zone impact from everything else.
    expect(screen.getByText('Thao tác này ảnh hưởng đến zone')).toBeInTheDocument()
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

  it('names the cells whose recorded progress a merge would discard, and shows the survivor as reshaped rather than lost', async () => {
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
    //
    // R1C1 (Coat 1, 100 m²) and R1C2 (Coat 3, 100 m²) merge into R1C1 over
    // 200 m². R1C1's code survives (task-8-fix-3 R6), so it lands in the
    // RESHAPED section, not the progress-loss one: the deck would otherwise
    // silently claim Coat 1 complete across 200 m² when only 100 m² was ever
    // ticked, which is exactly the silent-inflation defect R5 exists to catch.
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
    // keeps its row: it is the survivor and its Coat 1 is NOT lost -- but its
    // area moved from 100 to 200 m², so it must appear here, not below.
    expect(await screen.findByText(listItem('R1C2 — Coat 3'))).toBeInTheDocument()
    expect(screen.queryByText(listItem('R1C1 — Coat 1'))).toBeNull()
    // The survivor caveat this decision requires: kept in reshaped, both its
    // areas shown, vi-VN formatted.
    expect(screen.getByText(listItem('R1C1 — Coat 1: 100,00 → 200,00 m²'))).toBeInTheDocument()
    // Each section owns its own sentence -- both must be present at once here,
    // since both lists are non-empty simultaneously. Folding them back under
    // one umbrella sentence (the round-2 defect) can show at most one of the
    // two, so this pair fails under that mutation.
    expect(screen.getByText('Các ô này sẽ mất tiến độ đã ghi:')).toBeInTheDocument()
    expect(screen.getByText(/Các ô này giữ tiến độ đã ghi nhưng diện tích thay đổi/)).toBeInTheDocument()
    // No sentence may claim, as an umbrella, that recorded progress is being
    // wiped -- R1C1 is listed below and keeps its progress; the round-2 lead
    // paragraph asserted the opposite about it.
    expect(screen.queryByText(/sẽ xoá tiến độ đã ghi/)).toBeNull()
    // The merge-only caveat: there is no honest carry rule for the cell that
    // did not survive, so the dialog says so. Deleting the `kind === 'merge'`
    // guard on this paragraph would restore exactly the overstatement it
    // exists to remove, and ship green unless this is asserted.
    expect(screen.getByText(/Ô sống sót giữ tiến độ của chính nó/)).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()

    // 'Vẫn gộp' -- EDIT_CONFIRM.merge -- is not exercised by any other test.
    syncCells.mockResolvedValue(undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn gộp' }))
    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([
      { code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 200 },
    ])
  })

  it('discloses that the guides and the declared area go down with the write, on all three paths', async () => {
    // C4. Since A1 collapsed the two save buttons into one, `apply` writes
    // saveGuides and updateDeckArea on EVERY path through this dialog -- but the
    // dialog spoke only of cells and zones. Linh nudges a guide by accident, or
    // types a candidate area she means to reconsider, then deletes one cell, and
    // both edits are committed with nothing having said so.
    //
    // Unconditional, so all three EditKinds are checked: 'delete' and 'merge'
    // are the two where the disclosure is least expected and most needed, and
    // 'mesh' is the one where a conditional version would most plausibly have
    // been thought sufficient.
    const DISCLOSURE = /cũng lưu luôn bảng guide và diện tích sàn/
    const twoTickedCells = [
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: 'coat1' },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: 'coat3' },
    ]
    const stages = [
      { id: 'coat1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.15 },
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.85 },
    ]

    // delete: one ticked cell selected, so there is progress to lose and the
    // dialog opens.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    listCells.mockResolvedValue(twoTickedCells)
    listStages.mockResolvedValue(stages)
    let view = render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: 'chọn R1C1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Xoá ô đã chọn' }))
    await screen.findByRole('button', { name: 'Vẫn xoá' })
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
    view.unmount()

    // merge: both cells, so the survivor keeps its row and the other's tick goes.
    view = render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))
    await screen.findByRole('button', { name: 'Vẫn gộp' })
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
    view.unmount()

    // mesh: ONE_BAY_GUIDES generates a single R1C1, so persisted R1C2 is dropped.
    view = render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))
    await screen.findByRole('button', { name: 'Vẫn lưu' })
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
  })

  it('does not show the merge-survivor caveat for a delete, even with progress at stake', async () => {
    // The caveat is specifically about a MERGE's missing honest carry rule --
    // a delete has no survivor at all, so showing it here would promise a
    // cell that was never part of the operation.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100, stageId: 'coat1' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.2 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Xoá ô đã chọn' }))

    expect(await screen.findByText(listItem('R1C1 — Coat 1'))).toBeInTheDocument()
    expect(screen.queryByText(/Ô sống sót giữ tiến độ/)).toBeNull()
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('raises the dialog on its own for a reshape that carries a stage onto a very different extent', async () => {
    // The review's own example: same code, same stage, no vanished code and
    // no zone impact -- so before this round, reviewEdit's gate had nothing
    // to trip on and this applied with no confirmation at all, silently
    // moving 168 m² of "Coat 3 complete" onto ground nobody inspected.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 20000 },
      { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g4', axis: 'y', pos: 1, offsetMm: 20000 },
    ])
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    // The title collapses to one generic form once it is not a zone-impact
    // case (task-8-fix-3 R6) -- it no longer names the operation or the reason.
    expect(await screen.findByText('Xác nhận thay đổi lưới ô')).toBeInTheDocument()
    // vi-VN formatted, in the exact form the review specified.
    expect(screen.getByText(listItem('R1C1 — Coat 3: 232,00 → 400,00 m²'))).toBeInTheDocument()
    expect(screen.getByText(/Các ô này giữ tiến độ đã ghi nhưng diện tích thay đổi/)).toBeInTheDocument()
    // Neither of the other two sections applies here -- there is no zone
    // impact and nothing is actually being deleted -- so asserting either
    // would catch this dialog quietly reverting to an overstatement.
    expect(screen.queryByText(/Các ô này đang thuộc zone/)).toBeNull()
    expect(screen.queryByText('Các ô này sẽ mất tiến độ đã ghi:')).toBeNull()
    expect(screen.queryByText(/sẽ xoá tiến độ đã ghi/)).toBeNull()
    expect(syncCells).not.toHaveBeenCalled()

    syncCells.mockResolvedValue(undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([
      { code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 400 },
    ])
  })

  it('does not raise the dialog for a reshape that stays within the divergence threshold', async () => {
    // 240 m² is within 5% of 232 m² (AREA_DIVERGENCE_THRESHOLD), so this
    // applies with no confirmation -- proving the threshold is guarded on the
    // low side too, not just raised unconditionally on any area change at all.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 20000 },
      { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g4', axis: 'y', pos: 1, offsetMm: 12000 },
    ])
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([
      { code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 240 },
    ])
  })

  it('guards the reshape check\'s denominator: diverges against the OLD area, not the new one', async () => {
    // The re-review mutated the reshape check's argument order -- denominator
    // from the old area to the new -- and all 24 tests at the time still
    // passed. Both existing R5 cases use ratios too extreme for the choice to
    // matter (232->400 is 72.4% one way and 42.0% the other; 232->240 is
    // 3.45% and 3.33%). 200 -> 210,4 m² is chosen so the two denominators
    // straddle 5%: 5.20% against the old area (200, the shipped and correct
    // choice -- must raise the dialog) and 4.94% against the new area (210.4,
    // what the mutated argument order would compute -- must not raise). The
    // window is narrow by construction: for the two denominators to straddle
    // 5% the new area must fall between 1.0500 and 1.0526 times the old one;
    // 210,4 / 200 = 1.052 sits inside it.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 20000 },
      { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g4', axis: 'y', pos: 1, offsetMm: 10520 },
    ])
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 200, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    expect(await screen.findByText(listItem('R1C1 — Coat 3: 200,00 → 210,40 m²'))).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('raises the dialog for a shrink past the threshold too, not only for growth', async () => {
    // Both R5 cases grow. By inspection shrinking is symmetric -- the
    // denominator is always p.areaM2 and divergesBeyondThreshold takes
    // Math.abs -- but that is reasoning, not a test, and a denominator-argument
    // bug of exactly the R7 kind tends to surface as growth-fires-but-shrink-
    // does-not rather than as something direction-symmetric.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES) // one 232 m² bay, as elsewhere in this file
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 400, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    expect(await screen.findByText(listItem('R1C1 — Coat 3: 400,00 → 232,00 m²'))).toBeInTheDocument()
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

    expect(await screen.findByText('Xác nhận thay đổi lưới ô')).toBeInTheDocument()
    // The progress-loss section carries its own claim now; there is no
    // shared sentence left to assert "no zone impact" against.
    expect(screen.getByText('Các ô này sẽ mất tiến độ đã ghi:')).toBeInTheDocument()
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

  it('records the provenance of the cells it writes, not of the guides at save time', async () => {
    // A1, forwards. Generate the mesh BEFORE typing the mm spans, so the cells
    // hold pro-rated pixel shares, then type the spans, then save. area_source
    // used to be re-derived from the guide table at save time and came out
    // 'guides' -- pixel estimates persisted and labelled as measured. And
    // pro-rated areas sum to total_area_m2 exactly, so the divergence banner,
    // the only guard against this, can never fire: on Main Deck it reports
    // about 50.9% for a deck truly at 48.5%, with nothing anywhere disclosing
    // that the figures are estimates.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 1, offsetMm: 0 },
      { id: 'g3', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g4', axis: 'y', pos: 1, offsetMm: 0 },
    ])
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    expect(await screen.findByText(/không phải đo thật/)).toBeInTheDocument()

    // Now type the real spans, exactly as the admin would after reading them off
    // the drawing. Row 1 of each axis is the datum ("gốc"), so each guide table
    // holds precisely one span input.
    const spanIn = (title: string) => {
      const table = screen.getByText(title).closest('.ant-table-wrapper') as HTMLElement
      return within(table).getByRole('spinbutton')
    }
    await userEvent.clear(spanIn('Guide dọc (cột)'))
    await userEvent.type(spanIn('Guide dọc (cột)'), '14500')
    await userEvent.clear(spanIn('Guide ngang (hàng)'))
    await userEvent.type(spanIn('Guide ngang (hàng)'), '16000')

    // The banner must NOT go away: it describes the cells on screen, which are
    // still pro-rated estimates. It disappearing here is what made the defect
    // invisible -- the guides now read as measured while the cells are not.
    await waitFor(() => expect(screen.getByDisplayValue('16000')).toBeInTheDocument())
    expect(screen.getByText(/không phải đo thật/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    // The label and the areas agree: pro-rated cells, recorded as pro-rated.
    // 5258.5 m² is the whole declared deck in one bay, not the 232 m² the typed
    // spans would have measured.
    expect(syncCells.mock.calls[0][1]).toEqual([
      { code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 5258.5 },
    ])
    expect(updateDeckArea).toHaveBeenCalledWith('d1', 5258.5, 'prorated')
  })

  it('keeps measured provenance when the mm-bearing guide is deleted after the mesh was built', async () => {
    // A1, backwards, and the direction a state flag can get wrong on its own.
    // The cells were measured off real spans; deleting the guide that carried
    // the millimetres makes the guide table read as having none, but the areas
    // already computed are still measurements. Re-deriving from the table would
    // relabel 232 m² of measured bay as an estimate.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    expect(await screen.findByText('232,00')).toBeInTheDocument()
    expect(screen.queryByText(/không phải đo thật/)).toBeNull()

    // Drop the x-guide carrying 14500 mm.
    const xTable = screen.getByText('Guide dọc (cột)').closest('.ant-table-wrapper') as HTMLElement
    await userEvent.click(within(xTable).getAllByRole('button', { name: 'Xoá' })[1])
    expect(screen.queryByText('14.500')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([
      { code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232 },
    ])
    expect(updateDeckArea).toHaveBeenCalledWith('d1', 5258.5, 'guides')
    // Still no prorate banner: nothing about the cells changed.
    expect(screen.queryByText(/không phải đo thật/)).toBeNull()
  })

  it('warns that a deck with no declared area reports 0% forever, and refuses to save', async () => {
    // A2. total_area_m2 is `not null default 0` and createDeck never sets it, so
    // this is the state every deck starts in. areaDivergence returns 0 for a
    // zero total (to avoid dividing by zero), which reads as "no divergence" --
    // so the divergence banner cannot cover this, and computeDeckProgress gives
    // every stage ratio 0 while computeProjectProgress gives the deck weight 0.
    // A fully authored, fully painted deck reports 0% and contributes nothing.
    const undeclared = { ...deck, totalAreaM2: 0 }
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232, stageId: null },
    ])
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={undeclared} onClose={vi.fn()} />)

    expect(await screen.findByText(/Chưa khai báo diện tích sàn/)).toBeInTheDocument()
    expect(screen.getByText(/sẽ luôn là 0%/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    expect(await screen.findByText(/Không lưu được: chưa khai báo diện tích sàn/)).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()
    // Refused before it even read the persisted cells: only the initial load's
    // call happened.
    expect(listCells).toHaveBeenCalledTimes(1)

    // And it is the area that is blocking, not the button: declare one and the
    // same click goes through. Without this the refusal could be a dead save
    // path and the test would not notice.
    const areaInput = screen.getByRole('spinbutton')
    await userEvent.clear(areaInput)
    await userEvent.type(areaInput, '5258,5')
    await waitFor(() => expect(screen.queryByText(/Chưa khai báo diện tích sàn/)).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))
    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
  })

  it('discloses a cell that grows out of a zero area, where a relative test sees no change', async () => {
    // A2's second half, and the worst case the reshape disclosure has. A deck
    // meshed before its area was declared holds cells at 0 m²; a GS can tick
    // them anyway. The admin then declares the real area and re-meshes, and
    // every cell jumps from 0 to hundreds of m² with its stage intact -- an
    // infinite relative change, which any ratio test reads as no change at all,
    // so the section rendered empty in exactly the case it exists for.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 0, stageId: 'coat2' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat2', seq: 2, name: 'Coat 2', color: '#faad14', weight: 0.2 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    expect(await screen.findByText(listItem('R1C1 — Coat 2: 0,00 → 232,00 m²'))).toBeInTheDocument()
    expect(screen.getByText(/Các ô này giữ tiến độ đã ghi nhưng diện tích thay đổi/)).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('does not claim the merge survivor leaves its zone', async () => {
    // A4. syncCells matches by code, so the survivor's code is in the new set:
    // its row is updated in place and it keeps its id and its zone_cells rows.
    // Passing it to zoneImpactOf made the gate announce "Zone 1: R1C1" and stop
    // the most common authoring operation there is behind a dialog about
    // something that does not happen -- and a disclosure dialog that cries wolf
    // is one the admin learns to skim.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    // Zoned like the reviewer's probe: the survivor is in Zone 1 and the source
    // is in nothing. The mock answers by id, so asking about the survivor really
    // does come back with a zone -- excluding it has to be the caller's job.
    zoneImpactOf.mockImplementation((_deckId: string, ids: string[]) =>
      Promise.resolve(
        ids.includes('c1') ? [{ zoneId: 'z1', zoneName: 'Zone 1', cellCodes: ['R1C1'] }] : [],
      ),
    )
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    // Applied straight through: nothing is at stake, so there is nothing to say.
    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(zoneImpactOf).toHaveBeenCalledWith('d1', ['c2'])
    expect(screen.queryByText('Thao tác này ảnh hưởng đến zone')).toBeNull()
    expect(screen.queryByText(/Zone 1/)).toBeNull()
  })

  it('confirms wiping every cell even when no progress and no zone is at stake', async () => {
    // A5. The gate only opened when some disclosure list was non-empty, so on a
    // deck with no progress and no zones "Chọn tất cả" then "Xoá ô đã chọn"
    // deleted every row immediately. Wiping a deck's geometry is categorically
    // different from editing it.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 2629.25, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 2629.25, stageId: null },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Xoá ô đã chọn' }))

    expect(await screen.findByText('Xoá toàn bộ lưới ô của sàn')).toBeInTheDocument()
    // The count, so the admin can tell a two-cell mistake from the whole deck.
    expect(screen.getByText(/2 ô hiện có sẽ bị xoá/)).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()

    syncCells.mockResolvedValue(undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn xoá' }))
    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([])
  })

  it('does not accuse a deck with no cells yet of losing any', async () => {
    // The other side of the wipe confirmation. Saving guides and an area before
    // the mesh exists is ordinary work, and there is nothing to destroy, so a
    // dialog announcing that zero cells will be removed would be pure noise --
    // and noise is what makes the real one skimmable.
    listGuides.mockResolvedValue(ONE_BAY_GUIDES)
    syncCells.mockResolvedValue(undefined)
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(syncCells.mock.calls[0][1]).toEqual([])
  })

  it('refuses to save when the last load failed', async () => {
    // A5's other half. load() fetches with Promise.all, so one transient failure
    // -- likely enough on a site tether -- leaves `cells` at [] behind the error
    // Alert. Saving from there ran the mesh path with an empty set and wiped the
    // deck's whole geometry, with no dialog at all: `persisted` is read fresh
    // inside reviewEdit, so the disclosures were computed correctly and then
    // applied to a cell set that came from a failed read.
    listCells.mockRejectedValue(new Error('Failed to fetch'))
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByText('Failed to fetch')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản vẽ và lưới ô' }))

    expect(await screen.findByText(/lần tải dữ liệu gần nhất thất bại/)).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()
    expect(saveGuides).not.toHaveBeenCalled()
    expect(updateDeckArea).not.toHaveBeenCalled()
    // Refused before reading anything: only the failed load's call happened.
    expect(listCells).toHaveBeenCalledTimes(1)
  })

  it('clamps a guide dragged past its neighbour instead of inverting the mm chain', async () => {
    // A6. A drag moves `pos` and leaves `offsetMm`, and every area is computed
    // from the offsets in POS order -- so once the two orders disagree,
    // spansFromOffsets yields a negative span and deriveCellArea's Math.abs
    // renders it as a perfectly ordinary bay.
    //
    // Three bays of 10000, 40000 and 10000 mm across a 10000 mm depth: 600 m².
    // Drag the 10000 mm guide (index 1, pos 0.5) past the one at pos 0.8 and,
    // unclamped, the pos-ordered offsets become 0, 50000, 10000, 60000 -- spans
    // 50000, -40000, 50000, which compute to 500 + 400 + 500 = 1400 m². Not a
    // relabelling: a different, plausible, 133%-too-large deck.
    listGuides.mockResolvedValue([
      { id: 'g1', axis: 'x', pos: 0, offsetMm: 0 },
      { id: 'g2', axis: 'x', pos: 0.5, offsetMm: 10000 },
      { id: 'g3', axis: 'x', pos: 0.8, offsetMm: 50000 },
      { id: 'g4', axis: 'x', pos: 1, offsetMm: 60000 },
      { id: 'g5', axis: 'y', pos: 0, offsetMm: 0 },
      { id: 'g6', axis: 'y', pos: 1, offsetMm: 10000 },
    ])
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')

    await userEvent.click(screen.getByRole('button', { name: 'kéo guide 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))

    expect(await screen.findByTestId('canvas')).toHaveTextContent('R1C1,R1C2,R1C3')
    expect(screen.getByText('600,00')).toBeInTheDocument()
    expect(screen.queryByText('1.400,00')).toBeNull()
    // No negative span reaches the guide table's min={0} InputNumber either.
    expect(screen.getByDisplayValue('40000')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('-40000')).toBeNull()
  })

  it('re-reads the cells from the database when the sync fails', async () => {
    // A10. syncCells is three round trips with no transaction: the upsert widens
    // the survivor, then the delete fails. setCells(next) never runs, so the
    // screen kept showing the pre-merge mesh while the database held the widened
    // R1C1 AND R1C2, overlapping and double-counting. Re-reading does not close
    // the atomicity gap -- that needs an RPC -- but it stops the screen
    // disagreeing with the database, so the overlap shows up in the Σ and in the
    // divergence banner instead of hiding behind stale state.
    const before = [
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ]
    // Call 1 is the initial load, call 2 is reviewEdit's own snapshot, call 3 is
    // the re-read after the failure -- and it returns what half-applying the
    // merge actually leaves behind: a widened R1C1 with R1C2 still there.
    listCells
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
      .mockResolvedValue([
        { ...before[0], w: 1, areaM2: 200 },
        before[1],
      ])
    syncCells.mockRejectedValue(new Error('delete blocked'))
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    await screen.findByTestId('canvas')
    expect(screen.getByText('200,00')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp ô đã chọn' }))

    expect(await screen.findByText('delete blocked')).toBeInTheDocument()
    // 300 m², what the database holds: the widened survivor plus the source the
    // delete failed to remove. The stale screen said 200.
    await waitFor(() => expect(screen.getByText('300,00')).toBeInTheDocument())
    expect(screen.queryByText('200,00')).toBeNull()
    expect(listCells).toHaveBeenCalledTimes(3)
  })

  it('surfaces an infrastructure error unchanged rather than swallowing it', async () => {
    // The fallback in the translator is the original message, so a failure it
    // has never heard of still reaches the admin instead of vanishing.
    listCells.mockRejectedValue(new Error('JWT expired'))
    render(<DeckEditor deck={deck} onClose={vi.fn()} />)
    expect(await screen.findByText('JWT expired')).toBeInTheDocument()
  })

  /** Reads the exact guides array the screen handed to DrawingCanvas. */
  const readGuides = () =>
    JSON.parse(screen.getByTestId('guides').textContent!) as
      { id: string; axis: 'x' | 'y'; pos: number; offsetMm: number }[]

  describe('re-railing interior guides on an edge drag (dimension-chain paste, step 3)', () => {
    // The real Main Deck across-chain, laid out the way the CURRENT
    // (pre-feature) workflow actually leaves guides: dragged into rough,
    // monotonic, but otherwise arbitrary positions unrelated to their mm
    // ratios. Re-railing is what corrects them once one edge is dragged to a
    // real position -- a fixture already laid out by ratio would not
    // exercise it at all.
    const REAL_OFFSETS = [0, 2500, 12000, 26500, 41000, 50500, 58100]

    it('re-rails every interior x-guide to its mm ratio when the LAST one is dragged to 0.8', async () => {
      const positions = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1]
      listGuides.mockResolvedValue(
        REAL_OFFSETS.map((offsetMm, i) => ({ id: `gx${i}`, axis: 'x', pos: positions[i], offsetMm })),
      )
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      // Guide 6's only neighbour (guide 5, pos 0.5) leaves 0.8 well clear, so
      // moveGuideClamped lets the drag through unclamped.
      await userEvent.click(screen.getByRole('button', { name: 'kéo guide 6 tới 0.8' }))

      const guides = readGuides()
      const total = REAL_OFFSETS[REAL_OFFSETS.length - 1]
      REAL_OFFSETS.forEach((offsetMm, i) => {
        // The mapping the whole feature rests on: pos = ratio * newEdgePos.
        // Asserting the actual numbers, not just "increased" -- a re-rail
        // that scattered guides anywhere still-increasing would pass a
        // weaker check.
        expect(guides[i].pos).toBeCloseTo((offsetMm / total) * 0.8, 9)
        // Dragging never edits the mm chain the admin typed.
        expect(guides[i].offsetMm).toBe(offsetMm)
      })
    })

    it('re-rails every interior x-guide when the FIRST one is dragged to 0.2 instead', async () => {
      const positions = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
      listGuides.mockResolvedValue(
        REAL_OFFSETS.map((offsetMm, i) => ({ id: `gx${i}`, axis: 'x', pos: positions[i], offsetMm })),
      )
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'kéo guide 0 tới 0.2' }))

      const guides = readGuides()
      const total = REAL_OFFSETS[REAL_OFFSETS.length - 1]
      REAL_OFFSETS.forEach((offsetMm, i) => {
        const ratio = offsetMm / total
        expect(guides[i].pos).toBeCloseTo(0.2 + ratio * (1 - 0.2), 9)
      })
    })

    it('does not re-rail an interior guide drag -- only moveGuideClamped governs it', async () => {
      const positions = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1]
      listGuides.mockResolvedValue(
        REAL_OFFSETS.map((offsetMm, i) => ({ id: `gx${i}`, axis: 'x', pos: positions[i], offsetMm })),
      )
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      // Guide 3 (pos 0.3) stays strictly between guides 2 (0.2) and 4 (0.4).
      await userEvent.click(screen.getByRole('button', { name: 'kéo guide 3 tới 0.2' }))

      const guides = readGuides()
      // Only the dragged guide moved (clamped between 0.2+gap and 0.4-gap);
      // every OTHER guide is untouched, not re-railed onto some new ratio.
      expect(guides[0].pos).toBe(0)
      expect(guides[1].pos).toBe(0.1)
      expect(guides[2].pos).toBe(0.2)
      expect(guides[4].pos).toBe(0.4)
      expect(guides[5].pos).toBe(0.5)
      expect(guides[6].pos).toBe(1)
    })

    it('does not re-rail on a degenerate axis with no mm chain yet, and leaves the others exactly where they were', async () => {
      // Guides added by double-click before any span was typed: nothing to
      // scale by, so this must behave exactly as plain moveGuideClamped.
      listGuides.mockResolvedValue([
        { id: 'g0', axis: 'x', pos: 0, offsetMm: 0 },
        { id: 'g1', axis: 'x', pos: 0.3, offsetMm: 0 },
        { id: 'g2', axis: 'x', pos: 0.6, offsetMm: 0 },
        { id: 'g3', axis: 'x', pos: 1, offsetMm: 0 },
      ])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'kéo guide 3 tới 0.8' }))

      const guides = readGuides()
      expect(guides[0].pos).toBe(0)
      expect(guides[1].pos).toBe(0.3)
      expect(guides[2].pos).toBe(0.6)
      // Only the dragged edge itself moved.
      expect(guides[3].pos).toBe(0.8)
    })
  })

  describe('pasting a dimension chain (dimension-chain paste, step 4)', () => {
    const REAL_CHAIN_TEXT = '2500 9500 14500 14500 9500 7600'

    it('previews a good paste with the right total and applies it as 7 guides spanning 0..1', async () => {
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      const xBox = within(screen.getByTestId('chain-box-x'))
      await userEvent.type(xBox.getByRole('textbox'), REAL_CHAIN_TEXT)
      await userEvent.click(xBox.getByRole('button', { name: 'Xem trước' }))

      // vi-VN grouped, via the shared formatter -- the brief's own example.
      expect(xBox.getByText('Tổng: 58.100 mm')).toBeInTheDocument()

      await userEvent.click(xBox.getByRole('button', { name: 'Áp dụng' }))

      const xGuides = readGuides()
        .filter((g) => g.axis === 'x')
        .sort((a, b) => a.offsetMm - b.offsetMm)
      expect(xGuides).toHaveLength(7)
      expect(xGuides.map((g) => g.offsetMm)).toEqual([0, 2500, 12000, 26500, 41000, 50500, 58100])
      // No existing x-guides to reuse edge positions from, so 0 and 1.
      expect(xGuides[0].pos).toBeCloseTo(0, 9)
      expect(xGuides[xGuides.length - 1].pos).toBeCloseTo(1, 9)
      expect(xGuides[1].pos).toBeCloseTo(2500 / 58100, 9)

      // Applying changed guides, not cells -- the note says so.
      expect(
        await screen.findByText('Đã đổi guide. Bấm "Sinh lưới ô" để cập nhật các ô.'),
      ).toBeInTheDocument()
    })

    it('applies a chain between the axis own existing edge positions, not 0 and 1, when guides already exist', async () => {
      listGuides.mockResolvedValue([
        { id: 'gx0', axis: 'x', pos: 0.2, offsetMm: 0 },
        { id: 'gx1', axis: 'x', pos: 0.7, offsetMm: 999 },
      ])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      const xBox = within(screen.getByTestId('chain-box-x'))
      await userEvent.type(xBox.getByRole('textbox'), REAL_CHAIN_TEXT)
      await userEvent.click(xBox.getByRole('button', { name: 'Xem trước' }))
      await userEvent.click(xBox.getByRole('button', { name: 'Áp dụng' }))

      const xGuides = readGuides()
        .filter((g) => g.axis === 'x')
        .sort((a, b) => a.offsetMm - b.offsetMm)
      expect(xGuides).toHaveLength(7)
      expect(xGuides[0].pos).toBeCloseTo(0.2, 9)
      expect(xGuides[xGuides.length - 1].pos).toBeCloseTo(0.7, 9)
      // Interior guide 1 (2500mm of 58100mm) lands at 0.2 + ratio * 0.5.
      expect(xGuides[1].pos).toBeCloseTo(0.2 + (2500 / 58100) * 0.5, 9)
    })

    it('shows the named-token Alert on a bad paste and leaves the guides untouched', async () => {
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      const xBox = within(screen.getByTestId('chain-box-x'))
      // 2500 is 4 digits (not 1-3), so not a thousands group; 9500 is 4
      // fraction digits (not 1-2), so not a decimal either -- the brief's own
      // worked rejection example.
      await userEvent.type(xBox.getByRole('textbox'), '2500 2500,9500 14500')
      await userEvent.click(xBox.getByRole('button', { name: 'Xem trước' }))

      expect(
        xBox.getByText('Không đọc được "2500,9500". Mỗi số cách nhau bằng dấu cách hoặc xuống dòng.'),
      ).toBeInTheDocument()
      expect(xBox.getByRole('button', { name: 'Áp dụng' })).toBeDisabled()
      expect(readGuides()).toEqual(ONE_BAY_GUIDES)
    })

    it('keeps Áp dụng disabled until the CURRENT text has been previewed successfully', async () => {
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      const xBox = within(screen.getByTestId('chain-box-x'))
      const apply = () => xBox.getByRole('button', { name: 'Áp dụng' })
      const textbox = xBox.getByRole('textbox')

      expect(apply()).toBeDisabled()

      await userEvent.type(textbox, REAL_CHAIN_TEXT)
      // Typed but not yet previewed.
      expect(apply()).toBeDisabled()

      await userEvent.click(xBox.getByRole('button', { name: 'Xem trước' }))
      expect(apply()).toBeEnabled()

      // Editing after a successful preview must invalidate it -- applying
      // must never read spans that describe text no longer in the box.
      await userEvent.type(textbox, ' 100')
      expect(apply()).toBeDisabled()
    })

    it('applying a chain on one axis does not touch the other axis guides', async () => {
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      const xBox = within(screen.getByTestId('chain-box-x'))
      await userEvent.type(xBox.getByRole('textbox'), REAL_CHAIN_TEXT)
      await userEvent.click(xBox.getByRole('button', { name: 'Xem trước' }))
      await userEvent.click(xBox.getByRole('button', { name: 'Áp dụng' }))

      const guides = readGuides()
      const yGuides = guides.filter((g) => g.axis === 'y')
      // ONE_BAY_GUIDES' two y-guides, g3 and g4, untouched.
      expect(yGuides).toEqual(ONE_BAY_GUIDES.filter((g) => g.axis === 'y'))
      expect(guides.filter((g) => g.axis === 'x')).toHaveLength(7)
    })
  })

  describe('auto-detecting the grid, with per-axis sensitivity sliders (detect-sliders)', () => {
    it('shows the live guide count for whatever guides are on screen, with no detection run yet', async () => {
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      expect(screen.getByText('2 đường dọc × 2 đường ngang → 1 ô')).toBeInTheDocument()
    })

    it('disables both sliders until a profile has been detected', async () => {
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      expect(screen.getByRole('slider', { name: 'Độ nhạy trục dọc' })).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('slider', { name: 'Độ nhạy trục ngang' })).toHaveAttribute('aria-disabled', 'true')
    })

    it('detects at the default 0.60 fraction on both axes, replaces the guides and updates the live count', async () => {
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))

      await waitFor(() => {
        expect(readGuides().filter((g) => g.axis === 'x')).toHaveLength(2)
      })
      const guides = readGuides()
      const xGuides = guides.filter((g) => g.axis === 'x').sort((a, b) => a.pos - b.pos)
      const yGuides = guides.filter((g) => g.axis === 'y').sort((a, b) => a.pos - b.pos)
      expect(xGuides.map((g) => g.pos)).toEqual([0.1, 0.5])
      expect(yGuides.map((g) => g.pos)).toEqual([0.15, 0.45])
      // Detected guides carry no mm dimension -- they route through
      // prorateCellAreas via `hasRealSpans`/generateMesh, same as any other
      // guide with offsetMm 0.
      expect(guides.every((g) => g.offsetMm === 0)).toBe(true)
      // ONE_BAY_GUIDES is entirely replaced, not merged with.
      expect(guides).toHaveLength(4)

      expect(screen.getByText('2 đường dọc × 2 đường ngang → 1 ô')).toBeInTheDocument()
      expect(screen.getByRole('slider', { name: 'Độ nhạy trục dọc' })).toHaveAttribute('aria-disabled', 'false')
    })

    it('moving the vertical-axis slider re-detects that axis only, from the cached profile', async () => {
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')
      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))
      await waitFor(() => expect(readGuides().filter((g) => g.axis === 'x')).toHaveLength(2))

      // Home = the slider's own minimum (0.30): a third, fainter vertical
      // line now clears the bar. The horizontal axis is untouched -- this is
      // the split the whole feature is built around.
      const xSlider = screen.getByRole('slider', { name: 'Độ nhạy trục dọc' })
      xSlider.focus()
      fireEvent.keyDown(xSlider, { key: 'Home', keyCode: 36, which: 36 })

      await waitFor(() => expect(readGuides().filter((g) => g.axis === 'x')).toHaveLength(3))
      expect(readGuides().filter((g) => g.axis === 'y')).toHaveLength(2)
      // The line COUNTS are what this test is about. The cell count is not
      // asserted here on purpose: the drawn-edge filter decides it, and pinning
      // it here would make every slider test fail whenever that rule changes.
      // It has its own test below.
      expect(screen.getByText(/^3 đường dọc × 2 đường ngang/)).toBeInTheDocument()

      // inkProfileFromImage's one expensive call is not repeated by a slider
      // move -- only linesFromProfile's cheap re-read of the cached profile is.
      expect(inkProfileFromImage).toHaveBeenCalledTimes(1)
    })

    it('moving the horizontal-axis slider re-detects that axis only, from the cached profile', async () => {
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')
      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))
      await waitFor(() => expect(readGuides().filter((g) => g.axis === 'y')).toHaveLength(2))

      // End = the slider's own maximum (0.90): only the strongest horizontal
      // line still clears the bar. The vertical axis is untouched.
      const ySlider = screen.getByRole('slider', { name: 'Độ nhạy trục ngang' })
      ySlider.focus()
      fireEvent.keyDown(ySlider, { key: 'End', keyCode: 35, which: 35 })

      await waitFor(() => expect(readGuides().filter((g) => g.axis === 'y')).toHaveLength(1))
      expect(readGuides().filter((g) => g.axis === 'x')).toHaveLength(2)
      expect(screen.getByText(/^2 đường dọc × 1 đường ngang/)).toBeInTheDocument()
    })

    it('detects only inside the region the admin drew', async () => {
      // The reason this feature has a crop step at all. Detection over the
      // whole sheet finds the page border and nothing else -- the border is
      // the ink bounding box, so every real beam spans a minority of it. The
      // region the admin drew has to reach the pixel pass, or the sliders are
      // tuning against the wrong yardstick.
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))

      await waitFor(() => {
        expect(inkProfileFromImage).toHaveBeenCalledWith('blob:drawing', {
          region: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 },
        })
      })
    })

    it('puts the canvas in crop mode only until the region is committed', async () => {
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      // Not before: a canvas left in crop mode can neither drag a guide nor
      // select a cell, which is every other thing this screen does.
      expect(screen.queryByRole('button', { name: 'kéo khung sàn' })).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))

      // And not after committing: the box is settled.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'kéo khung sàn' })).not.toBeInTheDocument()
      })
    })

    it('hands the drawn region back to the canvas to draw', async () => {
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')
      expect(screen.getByTestId('crop')).toHaveTextContent('')

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))

      // Whatever the sliders then say, the admin can see which part of the
      // sheet the numbers are about.
      await waitFor(() => {
        expect(screen.getByTestId('crop')).toHaveTextContent('{"x":0.1,"y":0.1,"w":0.4,"h":0.5}')
      })
      // Matched by regex, not by the exact name: antd's loading spinner leaves
      // via a CSS transition that jsdom never completes, so its
      // `aria-label="loading"` icon stays mounted and the button's accessible
      // name keeps a "loading " prefix for the rest of the test. The label
      // itself is what this asserts -- the crop is remembered, so the button
      // now offers to replace it rather than to draw a first one.
      expect(await screen.findByRole('button', { name: /Chọn lại vùng sàn/ })).toBeInTheDocument()
    })

    it('leaves crop mode, and detects nothing, when the admin cancels', async () => {
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'Huỷ chọn vùng sàn' }))

      expect(screen.queryByRole('button', { name: 'kéo khung sàn' })).not.toBeInTheDocument()
      expect(inkProfileFromImage).not.toHaveBeenCalled()
      expect(readGuides()).toEqual(ONE_BAY_GUIDES)
    })

    it('does not detect when the drag ends -- only when the region is committed', async () => {
      // The admin has to see the box against the sheet and decide whether the
      // title block and the off-deck structure are outside it, which takes more
      // than one attempt. Detecting on mouse-up replaced the whole guide table
      // on every attempt.
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))

      expect(inkProfileFromImage).not.toHaveBeenCalled()
      expect(readGuides()).toEqual(ONE_BAY_GUIDES)
      // The box IS remembered and drawn, though -- that is what the admin is
      // looking at while they decide.
      expect(screen.getByTestId('crop')).toHaveTextContent('{"x":0.1,"y":0.1,"w":0.4,"h":0.5}')

      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))
      await waitFor(() => expect(inkProfileFromImage).toHaveBeenCalledTimes(1))
    })

    it('re-dragging replaces the region, and only the last one is detected', async () => {
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn nhỏ' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))

      await waitFor(() => {
        expect(inkProfileFromImage).toHaveBeenCalledWith('blob:drawing', {
          region: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
        })
      })
      expect(inkProfileFromImage).toHaveBeenCalledTimes(1)
    })

    it('cannot commit a region that was never drawn', async () => {
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      expect(screen.getByRole('button', { name: 'Dò lưới trong khung' })).toBeDisabled()
    })

    it('deletes the guide the admin clicked, while line-deleting is on', async () => {
      // The answer to "no slider position satisfies the whole sheet": be
      // generous with the slider, then click off the wrong lines.
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      // Not armed until asked -- a stray click on a dense grid would otherwise
      // change the mesh with nothing said.
      expect(screen.queryByRole('button', { name: 'bấm xoá đường 1' })).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Bật xoá đường' }))
      await userEvent.click(screen.getByRole('button', { name: 'bấm xoá đường 1' }))

      // g2 gone, the other three untouched, and the mode is still on for the
      // next wrong line.
      expect(readGuides()).toEqual([ONE_BAY_GUIDES[0], ONE_BAY_GUIDES[2], ONE_BAY_GUIDES[3]])
      expect(screen.getByRole('button', { name: 'Tắt xoá đường' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Tắt xoá đường' }))
      expect(screen.queryByRole('button', { name: 'bấm xoá đường 1' })).not.toBeInTheDocument()
    })

    it('offers nothing to delete when there are no guides', async () => {
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      expect(screen.getByRole('button', { name: 'Bật xoá đường' })).toBeDisabled()
    })

    it('counts only the cells the drawing encloses, and says how many it dropped', async () => {
      // A grid of guides makes a cell per crossing whether the sheet draws that
      // bay or not, so a mesh over a real deck covers the E-house, the circular
      // structures and the blank corners with cells nobody will ever paint. The
      // count next to the sliders has to be the number the admin will actually
      // get, or they tune against a number that is not the answer.
      //
      // At the vertical slider's minimum the fixture yields three vertical
      // guides, and its faintest line (7 of 19 rows) is too short to enclose
      // the second cell -- the same shape as a beam that stops part-way.
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')
      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))
      await waitFor(() => expect(readGuides().filter((g) => g.axis === 'x')).toHaveLength(2))

      const xSlider = screen.getByRole('slider', { name: 'Độ nhạy trục dọc' })
      xSlider.focus()
      fireEvent.keyDown(xSlider, { key: 'Home', keyCode: 36, which: 36 })

      expect(await screen.findByText(
        '3 đường dọc × 2 đường ngang → 1 ô (đã bỏ 1 ô không có khung trên bản vẽ)',
      )).toBeInTheDocument()
    })

    it('generates only the cells the drawing encloses', async () => {
      // The count above and the mesh actually built have to come from the same
      // filter -- a count that promised one thing and a Save that wrote another
      // is worse than no count at all.
      inkProfileFromImage.mockResolvedValue(fixtureProfile())
      listGuides.mockResolvedValue([])
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')
      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))
      await waitFor(() => expect(readGuides().filter((g) => g.axis === 'x')).toHaveLength(2))

      const xSlider = screen.getByRole('slider', { name: 'Độ nhạy trục dọc' })
      xSlider.focus()
      fireEvent.keyDown(xSlider, { key: 'Home', keyCode: 36, which: 36 })
      await screen.findByText(/đã bỏ 1 ô/)

      await userEvent.click(screen.getByRole('button', { name: 'Sinh lưới ô' }))

      // One cell reaches the canvas, not the two the 3x2 grid would give. Read
      // off the per-cell buttons the canvas stand-in renders, so this counts
      // cells rather than matching a joined string that other stand-in output
      // now precedes.
      expect(screen.getAllByRole('button', { name: /^chọn R/ })).toHaveLength(1)
    })

    it('does not drop hand-drawn cells, having no pixels to check them against', async () => {
      // With no detection run there is no record of what the sheet draws, and a
      // cell vanishing from a hand-built grid would be indistinguishable from
      // losing it.
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      expect(screen.getByText('2 đường dọc × 2 đường ngang → 1 ô')).toBeInTheDocument()
    })

    it('shows a Vietnamese message when detection fails, and leaves the existing guides alone', async () => {
      inkProfileFromImage.mockRejectedValue(new Error('canvas boom'))
      listGuides.mockResolvedValue(ONE_BAY_GUIDES)
      render(<DeckEditor deck={deck} onClose={vi.fn()} />)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Chọn vùng sàn để dò lưới' }))
      await userEvent.click(screen.getByRole('button', { name: 'kéo khung sàn' }))
      await userEvent.click(screen.getByRole('button', { name: 'Dò lưới trong khung' }))

      expect(
        await screen.findByText('Không tự động dò được lưới từ bản vẽ này. Hãy kẻ guide thủ công.'),
      ).toBeInTheDocument()
      expect(readGuides()).toEqual(ONE_BAY_GUIDES)
    })
  })
})

describe('mergeErrorInVietnamese', () => {
  // Unit-tested directly, unlike the other three markers this function
  // matches (covered end to end through the rendered screen above): `cells`
  // and `selected` both hold unique codes by construction under every UI
  // path that reaches mergeCells, so there is no way to select the same cell
  // twice through the DOM and drive mergeCells' 4th error that way.
  it('translates the duplicate-cell merge error', () => {
    const translated = mergeErrorInVietnamese('Merge selection contains the same cell more than once')
    expect(translated).not.toMatch(/same cell more than once/i)
    expect(translated).toMatch(/lặp lại/)
  })

  it('leaves an error it does not recognise unchanged', () => {
    expect(mergeErrorInVietnamese('Some new domain error')).toBe('Some new domain error')
  })
  it('names the axis that is still missing its mm chain', async () => {
    // The old copy said "no guide carries a mm dimension" for ANY prorated
    // deck, including one where the admin had just pasted a chain on one axis.
    // It read as "nothing you did registered", which is how the paste feature
    // came to look broken on its first real use.
    listGuides.mockResolvedValue([
      { id: 'gx1', axis: 'x', pos: 0, offsetMm: 0, label: null },
      { id: 'gx2', axis: 'x', pos: 1, offsetMm: 58100, label: null },
      { id: 'gy1', axis: 'y', pos: 0, offsetMm: 0, label: null },
      { id: 'gy2', axis: 'y', pos: 1, offsetMm: 0, label: null },
    ])
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100, stageId: null },
    ])
    render(<DeckEditor deck={{ ...deck, areaSource: 'prorated' }} onClose={vi.fn()} />)

    expect(await screen.findByText(/Trục ngang đã có kích thước mm/)).toBeInTheDocument()
    expect(screen.queryByText(/Chưa có guide nào mang kích thước mm/)).toBeNull()
  })

})
