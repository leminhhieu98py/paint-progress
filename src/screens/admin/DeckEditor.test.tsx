import { App as AntApp } from 'antd'
import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckEditor } from './DeckEditor'
import { mergeErrorInVietnamese } from './meshErrors'

const listCells = vi.hoisted(() => vi.fn())
const syncCells = vi.hoisted(() => vi.fn())
const zoneImpactOf = vi.hoisted(() => vi.fn())
const updateDeckArea = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
// The brief's original test omitted this mock even though one of its own
// tests (below) calls `listStages.mockResolvedValue(...)`. DeckEditor loads
// stages via decksApi.listStages to resolve a stage id to a human name for
// the progress-loss warning -- without mocking the module the real
// implementation would run (hitting supabase) and `listStages` would not even
// be a defined identifier in this file, so the test referencing it could not
// have run as written.
const listStages = vi.hoisted(() => vi.fn())
const detectBaysFromImage = vi.hoisted(() => vi.fn())

vi.mock('../../canvas/rgbFromImage', () => ({
  DETECT_RENDER_WIDTH: 3000,
  detectBaysFromImage: (url: string, region: unknown, options?: unknown) =>
    detectBaysFromImage(url, region, options),
}))
vi.mock('../../lib/decksApi', () => ({
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
  listStages: (id: string) => listStages(id),
}))
// One button per cell so a test can select a SUBSET, which "Chọn tất cả"
// cannot: a merge of some-but-not-all cells is the only shape in which the
// survivor's identity can be got wrong.
vi.mock('../../canvas/DrawingCanvas', () => ({
  DrawingCanvas: ({
    cells, selectedCodes, onCellClick, cellColors, onCellDraw, onSelectDraw,
  }: {
    cells: { code: string; x: number; w: number }[]
    selectedCodes: string[]
    onCellClick?: (code: string, additive: boolean) => void
    cellColors?: Record<string, string>
    onCellDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
    onSelectDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
  }) => (
    <div data-testid="canvas">
      {/* What is selected, which no button on this screen reports any more. */}
      <div data-testid="selection">{[...selectedCodes].sort().join(',')}</div>
      {/* Whether the canvas was put in draw-a-bay mode is observable only as
          these two, for the same reason the crop buttons exist. */}
      {onCellDraw && (
        <button onClick={() => onCellDraw({ x: 0.6, y: 0.6, w: 0.2, h: 0.2 })}>vẽ ô vào chỗ trống</button>
      )}
      {onCellDraw && (
        <button onClick={() => onCellDraw({ x: 0.05, y: 0.05, w: 0.2, h: 0.2 })}>vẽ ô đè lên ô cũ</button>
      )}
      {/* The Shift-band, which the canvas only offers while the shortcuts are on. */}
      {onSelectDraw && (
        <button onClick={() => onSelectDraw({ x: 0, y: 0, w: 0.3, h: 1 })}>quét chọn nửa trái</button>
      )}
      {/*
        Cell geometry, not just codes: a merge across an undrawn beam and a drop
        of one of the two cells leave the same COUNT behind, so only the
        surviving cell's own extent can tell them apart.
      */}
      <div data-testid="cell-geometry">
        {cells
          .map((c) => {
            const round = (v: number) => Math.round(v * 1e6) / 1e6
            return `${c.code}:${round(c.x)}+${round(c.w)}`
          })
          .join(' ')}
      </div>
      {cells.map((c) => c.code).join(',')}
      {cells.map((c) => (
        <button key={c.code} data-color={cellColors?.[c.code] ?? ''} onClick={() => onCellClick?.(c.code, true)}>
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
  imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600, drawingName: null, drawingPage: null,
  totalAreaM2: 5258.5, areaSource: 'prorated' as const, cellCount: 0,
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


/**
 * Mounts the editor the way src/App.tsx does. Not optional: the screen reports
 * a failed or refused write through antd's message API, and App.useApp()
 * outside an <App> provider hands back a context whose `message` has no
 * methods at all -- so any test reaching a failure path without this dies on
 * "message.error is not a function" rather than on what it meant to assert.
 */
const renderInApp = (deckProp: ComponentProps<typeof DeckEditor>['deck']) =>
  render(
    <AntApp>
      {/*
        A field beside the editor, which is where one really is: the deck's own
        form sits above this on the same page, and whether the keys yield to it
        is a thing about this screen, not about that form.
      */}
      <input aria-label="ô nhập bên cạnh" />
      <DeckEditor deck={deckProp} />
    </AntApp>,
  )

/**
 * Puts one full-deck bay on screen the way the admin gets cells now: drag a box
 * over the deck, then detect. Replaces the ONE_BAY_GUIDES + "Sinh lưới ô" idiom
 * these tests used before the guide workflow was removed. The bay covers the
 * whole region, so pro-rating hands it the entire declared deck area.
 */
const detectOneBay = async () => {
  detectBaysFromImage.mockResolvedValue([{ x: 0, y: 0, w: 1, h: 1 }])
  await userEvent.click(screen.getByRole('button', { name: 'Tự động dò ô từ bản vẽ' }))
}

/** What antd's message API has on screen, if anything. */
const toastText = () => document.querySelector('.ant-message')?.textContent ?? ''

/**
 * The buttons this screen used to carry are gone: selecting, deleting, merging
 * and saving are all keys now, and the keys only answer once the admin has
 * asked for them. These are the ways in, so a test says what the admin did
 * rather than which control they happened to reach for.
 */
const arm = async () => {
  // Waits on the button rather than on the canvas: a deck whose load failed has
  // no canvas, and refusing to save from that state is one of the things under
  // test here.
  const button = await screen.findByRole('button', { name: /Hiệu chỉnh ô|Thoát hiệu chỉnh ô/ })
  if (button.getAttribute('aria-label') === 'Hiệu chỉnh ô') await userEvent.click(button)
}
const press = (key: string, opts: Record<string, boolean> = {}) =>
  fireEvent.keyDown(window, { key, ...opts })
const selectAll = async () => {
  await arm()
  press('a', { metaKey: true })
}
const saveDeck = async () => {
  await arm()
  await userEvent.click(screen.getByRole('button', { name: 'Lưu hình học ô' }))
}

beforeEach(() => {
  for (const m of [
    listCells, syncCells, zoneImpactOf, updateDeckArea, getDrawingUrl, listStages,
    detectBaysFromImage,
  ]) m.mockReset()
  getDrawingUrl.mockResolvedValue('blob:drawing')
  listCells.mockResolvedValue([])
  zoneImpactOf.mockResolvedValue([])
  listStages.mockResolvedValue([])
})

describe('DeckEditor', () => {

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    expect(screen.getByRole('button', { name: 'chọn R1C1' })).toHaveAttribute('data-color', '#1677ff')
    expect(screen.getByRole('button', { name: 'chọn R1C2' })).toHaveAttribute('data-color', '')
  })







  it('warns when the cell areas diverge from the deck total beyond 5%', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100, stageId: null },
    ])
    renderInApp(deck)
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
    renderInApp(deck)
    expect(await screen.findByText(/vượt 14,10%/)).toBeInTheDocument()
  })

  it('does not warn when the areas agree', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 5258.5, stageId: null },
    ])
    renderInApp(deck)
    await screen.findByTestId('canvas')
    expect(screen.queryByText(/lệch/i)).toBeNull()
  })

  it('does not warn on a deck that has no cells yet', async () => {
    // An empty cell set diverges from any declared area by exactly 100%, so
    // without a guard every untouched deck greets the admin with a warning
    // about work they have not done yet -- and a banner that is always on is
    // a banner nobody reads.
    renderInApp(deck)
    await screen.findByTestId('canvas')
    expect(screen.queryByText(/lệch/i)).toBeNull()
  })




  it('saves a generated mesh that needed no delete and no merge', async () => {
    // The defect this covers: syncCells' predecessor was reachable only from a
    // delete or a merge, so a deck whose outline came out right first time
    // could never persist its cells at all -- while the separate
    // guides-and-area button happily wrote new offsets and a new area_source
    // next to the old areas. Both are one action now, so this also pins that
    // collapsing them did not lose the cell write.
    syncCells.mockResolvedValue(undefined)
    renderInApp({ ...deck, totalAreaM2: 232 })
    await screen.findByTestId('canvas')

    await detectOneBay()
    await saveDeck()

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
    listCells.mockResolvedValue([
      { id: 'c9', code: 'R9C9', x: 0, y: 0, w: 1, h: 1, areaM2: 300, stageId: 'coat1' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.2 },
    ])
    renderInApp({ ...deck, totalAreaM2: 232 })
    await screen.findByTestId('canvas')

    await detectOneBay()
    await saveDeck()

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

  it('will not run two merges over one selection', async () => {
    // Merging awaits two round trips (listCells, zoneImpactOf) before it can
    // even open the confirmation dialog, and nothing stopped a second M landing
    // in that gap from starting a second pass over the same selection --
    // whichever one's proposal was written second is the one the admin
    // confirmed, and it need not be the one they read.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    let resolveZoneImpact: (v: unknown[]) => void = () => {}
    zoneImpactOf.mockImplementation(
      () => new Promise((resolve) => { resolveZoneImpact = resolve }),
    )
    renderInApp(deck)
    await selectAll()

    press('m')
    // The initial load's listCells, plus the review's own re-read.
    await waitFor(() => expect(listCells).toHaveBeenCalledTimes(2))
    press('m')
    expect(listCells).toHaveBeenCalledTimes(2)

    resolveZoneImpact([])
    await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument())
  })

  it('names the affected zones before deleting a cell', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    zoneImpactOf.mockResolvedValue([
      { zoneId: 'z1', zoneName: 'Zone 3', cellCodes: ['R1C1'] },
    ])
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('Delete')
    await saveDeck()

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('Delete')
    await saveDeck()
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn lưu' }))

    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([])
  })

  it('tells syncCells which sources a merged cell inherits zones from', async () => {
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 100, stageId: null },
    ])
    syncCells.mockResolvedValue(undefined)
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('m')

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('m')

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
    // updateDeckArea on EVERY path through this dialog -- but the
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
    listCells.mockResolvedValue(twoTickedCells)
    listStages.mockResolvedValue(stages)
    let view = renderInApp(deck)
    await arm()
    await userEvent.click(screen.getByRole('button', { name: 'chọn R1C1' }))
    press('Delete')
    await saveDeck()
    await screen.findByRole('button', { name: 'Vẫn lưu' })
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
    view.unmount()

    // merge: both cells, so the survivor keeps its row and the other's tick goes.
    view = renderInApp(deck)
    await screen.findByTestId('canvas')
    await selectAll()
    press('m')
    await screen.findByRole('button', { name: 'Vẫn gộp' })
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
    view.unmount()

    // mesh: detection returns a single R1C1, so persisted R1C2 is dropped.
    view = renderInApp(deck)
    await screen.findByTestId('canvas')
    await detectOneBay()
    await saveDeck()
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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('Delete')
    await saveDeck()

    expect(await screen.findByText(listItem('R1C1 — Coat 1'))).toBeInTheDocument()
    expect(screen.queryByText(/Ô sống sót giữ tiến độ/)).toBeNull()
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('raises the dialog on its own for a reshape that carries a stage onto a very different extent', async () => {
    // The review's own example: same code, same stage, no vanished code and
    // no zone impact -- so before this round, reviewEdit's gate had nothing
    // to trip on and this applied with no confirmation at all, silently
    // moving 168 m² of "Coat 3 complete" onto ground nobody inspected.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    renderInApp({ ...deck, totalAreaM2: 400 })
    await screen.findByTestId('canvas')

    await detectOneBay()
    await saveDeck()

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
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 232, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    syncCells.mockResolvedValue(undefined)
    renderInApp({ ...deck, totalAreaM2: 240 })
    await screen.findByTestId('canvas')

    await detectOneBay()
    await saveDeck()

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
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 200, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    renderInApp({ ...deck, totalAreaM2: 210.4 })
    await screen.findByTestId('canvas')

    await detectOneBay()
    await saveDeck()

    expect(await screen.findByText(listItem('R1C1 — Coat 3: 200,00 → 210,40 m²'))).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('raises the dialog for a shrink past the threshold too, not only for growth', async () => {
    // Both R5 cases grow. By inspection shrinking is symmetric -- the
    // denominator is always p.areaM2 and divergesBeyondThreshold takes
    // Math.abs -- but that is reasoning, not a test, and a denominator-argument
    // bug of exactly the R7 kind tends to surface as growth-fires-but-shrink-
    // does-not rather than as something direction-symmetric.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 400, stageId: 'coat3' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
    ])
    renderInApp({ ...deck, totalAreaM2: 232 })
    await screen.findByTestId('canvas')

    await detectOneBay()
    await saveDeck()

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

        await arm()
await userEvent.click(screen.getByRole('button', { name: 'chọn R1C1' }))
    await userEvent.click(screen.getByRole('button', { name: 'chọn R1C2' }))
    press('m')

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('m')

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('m')

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('m')

    expect(await screen.findAllByText(/hình chữ nhật kín/)).not.toHaveLength(0)
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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('m')

    expect(await screen.findAllByText(/bị trùng nhau/)).not.toHaveLength(0)
    expect(screen.queryByText(/overlapping cells/i)).toBeNull()
  })



  it('warns that a deck with no declared area reports 0% forever, and refuses to save', async () => {
    // Every ratio divides by the deck area, so a deck that declares none reports
    // 0% for ever -- and computeProjectProgress gives it weight 0, so it drags
    // nothing into the project rollup either. Silently, and permanently.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 0, stageId: null },
    ])
    renderInApp({ ...deck, totalAreaM2: 0 })

    expect(await screen.findByText(/Chưa khai báo diện tích sàn/)).toBeInTheDocument()

    await saveDeck()

    expect(await screen.findAllByText(/Không lưu được: chưa khai báo diện tích sàn/)).not.toHaveLength(0)
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('discloses a cell that grows out of a zero area, where a relative test sees no change', async () => {
    // A2's second half, and the worst case the reshape disclosure has. A deck
    // meshed before its area was declared holds cells at 0 m²; a GS can tick
    // them anyway. The admin then declares the real area and re-meshes, and
    // every cell jumps from 0 to hundreds of m² with its stage intact -- an
    // infinite relative change, which any ratio test reads as no change at all,
    // so the section rendered empty in exactly the case it exists for.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 0, stageId: 'coat2' },
    ])
    listStages.mockResolvedValue([
      { id: 'coat2', seq: 2, name: 'Coat 2', color: '#faad14', weight: 0.2 },
    ])
    renderInApp({ ...deck, totalAreaM2: 232 })
    await screen.findByTestId('canvas')

    await detectOneBay()
    await saveDeck()

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('m')

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
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await selectAll()
    press('Delete')
    await saveDeck()

    expect(await screen.findByText('Xoá toàn bộ lưới ô của sàn')).toBeInTheDocument()
    // The count, so the admin can tell a two-cell mistake from the whole deck.
    expect(screen.getByText(/2 ô hiện có sẽ bị xoá/)).toBeInTheDocument()
    expect(syncCells).not.toHaveBeenCalled()

    syncCells.mockResolvedValue(undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    expect(syncCells.mock.calls[0][1]).toEqual([])
  })

  it('does not accuse a deck with no cells yet of losing any', async () => {
    // The other side of the wipe confirmation. Saving guides and an area before
    // the mesh exists is ordinary work, and there is nothing to destroy, so a
    // dialog announcing that zero cells will be removed would be pure noise --
    // and noise is what makes the real one skimmable.
    syncCells.mockResolvedValue(undefined)
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await saveDeck()

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
    renderInApp(deck)
    await screen.findByText('Failed to fetch')

    await saveDeck()

    expect(await screen.findAllByText(/lần tải dữ liệu gần nhất thất bại/)).not.toHaveLength(0)
    expect(syncCells).not.toHaveBeenCalled()
    expect(updateDeckArea).not.toHaveBeenCalled()
    // Refused before reading anything: only the failed load's call happened.
    expect(listCells).toHaveBeenCalledTimes(1)
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
    renderInApp(deck)
    await screen.findByTestId('canvas')
    expect(screen.getByText('200,00')).toBeInTheDocument()

    await selectAll()
    press('m')

    expect(await screen.findAllByText('delete blocked')).not.toHaveLength(0)
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
    renderInApp(deck)
    expect(await screen.findByText('JWT expired')).toBeInTheDocument()
  })




  describe('reading the bays out of the drawing', () => {
    const BAYS = [
      { x: 0.1, y: 0.1, w: 0.35, h: 0.35 },
      { x: 0.5, y: 0.1, w: 0.4, h: 0.35 },
      { x: 0.1, y: 0.5, w: 0.8, h: 0.4 },
    ]



    it('turns the bays into cells, named by where they sit and sharing the deck area', async () => {
      // Cells, not guides: a bay is a closed region on the sheet, so there is
      // nothing left to generate afterwards. The third bay spans both columns,
      // which a grid of guides could not have produced.
      detectBaysFromImage.mockResolvedValue(BAYS)
      renderInApp(deck)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Tự động dò ô từ bản vẽ' }))

      await waitFor(() => expect(screen.getByTestId('cell-geometry')).toHaveTextContent(
        'R1C1:0.1+0.35 R1C2:0.5+0.4 R2C1:0.1+0.8',
      ))
      expect(screen.getByText('3 ô đã dựng')).toBeInTheDocument()
      // Prorated: a detected bay carries no printed dimension, so its area is
      // its share of the deck's pixels. The three bays between them come to the
      // whole deck.
      expect(document.querySelectorAll('.ant-descriptions-item-content')[1]?.textContent)
        .toBe('5.258,50')
    })








    it('shows a Vietnamese message when detection fails, and leaves the cells alone', async () => {
      detectBaysFromImage.mockRejectedValue(new Error('canvas boom'))
      renderInApp(deck)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'Tự động dò ô từ bản vẽ' }))

      // Banner and toast both carry it, so this asks whether the admin was
      // told -- not which of the two channels told them.
      expect(
        await screen.findAllByText('Không tự động dò được ô từ bản vẽ này. Kiểm tra lại bản vẽ đã tải lên.'),
      ).not.toHaveLength(0)
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

  it('puts a refused save in front of an admin who has scrolled away from the banner', async () => {
    // The banner this duplicates sits at the very top of a page tall enough
    // to hold a full drawing. Measured in the running app: the admin clicks
    // "Xoá ô đã chọn" from beside the drawing and the refusal renders 385px
    // above the top of the viewport, so nothing at all appears to happen --
    // the cells stay on screen (setCells only runs after a successful write),
    // and the deck looks like it simply ignored the click.
    listCells.mockResolvedValue([
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100, stageId: null },
    ])
    renderInApp({ ...deck, totalAreaM2: 0 })
    await screen.findByTestId('canvas')

    await saveDeck()

    await waitFor(() => expect(toastText()).toContain('chưa khai báo diện tích sàn'))
    expect(syncCells).not.toHaveBeenCalled()
  })

  it('says a dropped connection in Vietnamese instead of pasting the browser at the admin', async () => {
    listCells
      .mockResolvedValueOnce([
        { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 100, stageId: null },
      ])
      // What a real drop looks like from fetch: a TypeError whose message is
      // this English string, which reviewEdit used to render verbatim.
      .mockRejectedValue(new TypeError('Failed to fetch'))
    renderInApp(deck)
    await screen.findByTestId('canvas')

    await saveDeck()

    await waitFor(() => expect(toastText()).toContain('Mất kết nối'))
    expect(screen.queryByText(/Failed to fetch/)).toBeNull()
  })


  describe('drawing a bay by hand', () => {
    const ONE_CELL = [
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 0.5, areaM2: 100, stageId: null },
    ]

    it('adds the bay the admin drew, under a code the grid cannot claim', async () => {
      // Detection leaves gaps no rule reaches -- a corner the drawing never
      // closed, a strip the beam grid has no line for. This is the way out of
      // them, and the alternative is re-detecting the whole deck and curating it
      // again. The code is X1, not R1C2: codes are the identity that zone
      // membership and recorded progress are matched on.
      listCells.mockResolvedValue(ONE_CELL)
      renderInApp(deck)
      await arm()

      press('i')
      await userEvent.click(screen.getByRole('button', { name: 'vẽ ô vào chỗ trống' }))

      expect(await screen.findByTestId('canvas')).toHaveTextContent('R1C1,X1')
      expect(screen.getByText('2 ô đã dựng')).toBeInTheDocument()
    })

    it('re-prorates every area, so the deck still sums to its declared total', async () => {
      // Areas are shares of the deck total. A bay added without re-sharing them
      // leaves the deck summing to more than it is, and every percentage on the
      // project reads low.
      listCells.mockResolvedValue(ONE_CELL)
      renderInApp({ ...deck, totalAreaM2: 400 })
      await arm()

      press('i')
      await userEvent.click(screen.getByRole('button', { name: 'vẽ ô vào chỗ trống' }))

      // 0.25 of the drawing against 0.04: 400 m² split 344.83 / 55.17.
      await waitFor(() => expect(screen.getByText('400,00')).toBeInTheDocument())
    })

    it('refuses a bay drawn on top of one that is already there', async () => {
      // Two bays over the same ground are two the GS can tick and two the report
      // counts, and the deck reads over 100% with paint left to do.
      listCells.mockResolvedValue(ONE_CELL)
      renderInApp(deck)
      await arm()

      press('i')
      await userEvent.click(screen.getByRole('button', { name: 'vẽ ô đè lên ô cũ' }))

      await waitFor(() => expect(toastText()).toContain('đã có ô'))
      expect(screen.getByTestId('canvas')).toHaveTextContent('R1C1')
      expect(screen.getByText('1 ô đã dựng')).toBeInTheDocument()
    })

  })

  describe('keyboard shortcuts', () => {
    const FOUR_CELLS = [
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.25, h: 0.5, areaM2: 100, stageId: null },
      { id: 'c2', code: 'R1C2', x: 0.25, y: 0, w: 0.25, h: 0.5, areaM2: 100, stageId: null },
      { id: 'c3', code: 'R2C1', x: 0, y: 0.5, w: 0.25, h: 0.5, areaM2: 100, stageId: null },
      { id: 'c4', code: 'R2C2', x: 0.25, y: 0.5, w: 0.25, h: 0.5, areaM2: 100, stageId: null },
    ]

    it('lists what every key does, so the admin does not have to be told', async () => {
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await arm()

      expect(screen.getByText('Esc')).toBeInTheDocument()
      expect(screen.getByText('Ctrl/Cmd + A')).toBeInTheDocument()
      expect(screen.getByText('Ctrl/Cmd + Z')).toBeInTheDocument()
      expect(screen.getByText('Ctrl/Cmd + Shift + Z')).toBeInTheDocument()
      expect(screen.getByText('Ctrl/Cmd + S')).toBeInTheDocument()
      expect(screen.getByText('Delete / Backspace')).toBeInTheDocument()
      expect(screen.getByText('I')).toBeInTheDocument()
    })

    it('takes no keys until the admin turns them on', async () => {
      // The editor shares its window with a deck-area field and the browser's
      // own Cmd+S. Listening before being asked would take those over from the
      // moment the screen opens.
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await screen.findByTestId('canvas')

      await userEvent.click(screen.getByRole('button', { name: 'chọn R1C1' }))
      press('Escape')

      expect(screen.getByTestId('selection')).toHaveTextContent('R1C1')
    })

    it('clears the selection on Esc', async () => {
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await arm()
      await selectAll()

      press('Escape')

      await waitFor(() => expect(screen.getByTestId('selection')).toHaveTextContent(''))
    })

    it('selects every bay on Ctrl/Cmd + A', async () => {
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await arm()

      press('a', { metaKey: true })

      await waitFor(() => expect(screen.getByTestId('selection')).toHaveTextContent('R1C1,R1C2,R2C1,R2C2'))
    })

    it('takes the bays a Shift-band swept', async () => {
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await arm()

      await userEvent.click(screen.getByRole('button', { name: 'quét chọn nửa trái' }))
      press('Delete')

      // The band covers the left column only: R1C1 and R2C1 go, the right stays.
      await waitFor(() => expect(screen.getByTestId('canvas')).toHaveTextContent('R1C2,R2C2'))
    })

    it('deletes the selection on Delete without writing anything yet', async () => {
      // Delete is an edit, not a save: the admin curates a deck of 180 bays and
      // then saves once. Writing on every keystroke would also put the
      // zone-and-progress gate in front of them 20 times in a row.
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await arm()
      await userEvent.click(screen.getByRole('button', { name: 'chọn R1C1' }))

      press('Backspace')

      await waitFor(() => expect(screen.getByText('3 ô đã dựng')).toBeInTheDocument())
      expect(syncCells).not.toHaveBeenCalled()
      // The deck total is the truth, so what is left absorbs the area.
      expect(document.querySelectorAll('.ant-descriptions-item-content')[1]?.textContent)
        .toBe('5.258,50')
    })

    it('puts back what Ctrl/Cmd + Z undoes, and takes it away again on redo', async () => {
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await arm()
      await userEvent.click(screen.getByRole('button', { name: 'chọn R1C1' }))
      press('Delete')
      await waitFor(() => expect(screen.getByText('3 ô đã dựng')).toBeInTheDocument())

      press('z', { metaKey: true })
      await waitFor(() => expect(screen.getByText('4 ô đã dựng')).toBeInTheDocument())

      press('z', { metaKey: true, shiftKey: true })
      await waitFor(() => expect(screen.getByText('3 ô đã dựng')).toBeInTheDocument())
    })

    it('keeps the browser out of the keys it takes', async () => {
      // Cmd+S opens the browser's own save dialog over the deck, and Backspace
      // outside a field is Back -- which leaves the editor entirely, taking
      // every unsaved edit with it.
      listCells.mockResolvedValue(FOUR_CELLS)
      syncCells.mockResolvedValue(undefined)
      renderInApp(deck)
      await arm()

      // Cmd+S last: it hands the keys back, so anything after it is not this
      // screen's to take.
      const taken = [
        fireEvent.keyDown(window, { key: 'Backspace' }),
        fireEvent.keyDown(window, { key: 'q' }),
        fireEvent.keyDown(window, { key: 's', metaKey: true }),
      ]
      expect(taken).toEqual([false, true, false])
    })

    it('saves and hands the keys back on Ctrl/Cmd + S', async () => {
      listCells.mockResolvedValue(FOUR_CELLS)
      syncCells.mockResolvedValue(undefined)
      renderInApp(deck)
      await arm()

      press('s', { metaKey: true })

      await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
      expect(await screen.findByRole('button', { name: 'Hiệu chỉnh ô' })).toBeInTheDocument()
    })

    it('turns drawing bays on and off with I', async () => {
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await arm()

      press('i')
      expect(await screen.findByRole('button', { name: 'vẽ ô vào chỗ trống' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'vẽ ô vào chỗ trống' })).toBeInTheDocument()

      press('i')
      expect(screen.queryByRole('button', { name: 'vẽ ô đè lên ô cũ' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'vẽ ô vào chỗ trống' })).not.toBeInTheDocument()
    })

    it('saves on Ctrl/Cmd + S even when a field has the keyboard', async () => {
      // Reported: the browser's own save dialog opened over the deck. The field
      // guard was handing Cmd+S back to the browser whenever the admin had last
      // touched the deck-area box -- which is most of the time, since that is
      // the field on this screen. Cmd+S is this screen's everywhere: nobody
      // editing a deck wants to save the HTML of it.
      listCells.mockResolvedValue(FOUR_CELLS)
      syncCells.mockResolvedValue(undefined)
      renderInApp(deck)
      await arm()
      const area = screen.getByLabelText('ô nhập bên cạnh')
      area.focus()

      expect(fireEvent.keyDown(area, { key: 's', metaKey: true })).toBe(false)

      await waitFor(() => expect(syncCells).toHaveBeenCalledTimes(1))
    })

    it('keeps its hands off the keyboard while a field has it', async () => {
      // Cmd+A in the deck-area field is "select this number", not "select every
      // bay on the deck", and the number is the denominator of every percentage
      // the project reports.
      listCells.mockResolvedValue(FOUR_CELLS)
      renderInApp(deck)
      await arm()
      const area = screen.getByLabelText('ô nhập bên cạnh')
      area.focus()

      fireEvent.keyDown(area, { key: 'a', metaKey: true })

      expect(screen.getByTestId('selection')).toHaveTextContent('')
    })
  })
})
