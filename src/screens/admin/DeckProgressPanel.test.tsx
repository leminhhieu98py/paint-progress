import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckProgressPanel } from './DeckProgressPanel'

const loadDeckProgress = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const createZone = vi.hoisted(() => vi.fn())
const updateZone = vi.hoisted(() => vi.fn())
const deleteZone = vi.hoisted(() => vi.fn())
const setZoneActual = vi.hoisted(() => vi.fn())

vi.mock('../../lib/progressApi', () => ({
  loadDeckProgress: (id: string) => loadDeckProgress(id),
}))
vi.mock('../../lib/decksApi', () => ({
  getDrawingUrl: (p: string) => getDrawingUrl(p),
}))
vi.mock('../../lib/adminApi', () => ({
  listGsUsers: () => Promise.resolve([{ id: 'u1', fullName: 'Lê Trung Hiếu' }]),
}))
vi.mock('../../lib/zonesApi', () => ({
  listDeckZones: (d: string) => listDeckZones(d),
  createZone: (d: string, draft: unknown, ids: string[]) => createZone(d, draft, ids),
  updateZone: (id: string, f: unknown) => updateZone(id, f),
  deleteZone: (id: string) => deleteZone(id),
  setZoneActual: (id: string, s: string) => setZoneActual(id, s),
}))

// Konva renders to a canvas, which jsdom does not implement. The double exposes
// what this panel is responsible for putting on one: which drawing, what colour
// each bay came out, what is selected, and what the plan says.
vi.mock('../../canvas/DrawingCanvas', () => ({
  DrawingCanvas: ({
    imageUrl, cells, cellColors, hatchedCodes, markedCodes, planLabels, selectedCodes,
    onCellClick, onSelectDraw,
  }: {
    imageUrl: string
    cells: { code: string }[]
    cellColors?: Record<string, string>
    hatchedCodes?: string[]
    markedCodes?: string[]
    planLabels?: Record<string, string>
    selectedCodes?: string[]
    onCellClick?: (code: string, additive: boolean) => void
    onSelectDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
  }) => (
    <div data-testid="canvas" data-image={imageUrl}>
      {cells.map((c) => (
        <button
          key={c.code}
          data-testid={`cell-${c.code}`}
          data-color={cellColors?.[c.code] ?? ''}
          data-hatched={String(Boolean(hatchedCodes?.includes(c.code)))}
          data-marked={String(Boolean(markedCodes?.includes(c.code)))}
          data-plan={planLabels?.[c.code] ?? ''}
          data-selected={String(Boolean(selectedCodes?.includes(c.code)))}
          onClick={() => onCellClick?.(c.code, false)}
        />
      ))}
      {/* Stands in for a Shift-drag across the whole drawing. */}
      <button data-testid="band-all" onClick={() => onSelectDraw?.({ x: 0, y: 0, w: 1, h: 1 })} />
    </div>
  ),
}))

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]

/** 1000 m² deck: one 500 m² bay at Tháo giáo, one at Coat 2. */
const ENTRY = {
  seq: 1,
  deck: {
    id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000,
    cells: [
      { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 500, stageId: 's3' },
      { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 500, stageId: 's2' },
    ],
  },
  stages: STAGES,
  imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
  areaSource: 'guides' as const,
  audit: {},
}

const ZONE = {
  id: 'z1', name: 'Khu A — Tháo giáo', stageId: 's3',
  startDate: '2026-09-01', finishDate: '2026-09-07', cellIds: ['c1'],
}

beforeEach(() => {
  loadDeckProgress.mockReset()
  loadDeckProgress.mockResolvedValue(ENTRY)
  getDrawingUrl.mockReset()
  getDrawingUrl.mockImplementation((p: string) => Promise.resolve(`https://signed/${p}`))
  listDeckZones.mockReset()
  listDeckZones.mockResolvedValue([])
  createZone.mockReset()
  createZone.mockResolvedValue('z1')
  updateZone.mockReset()
  updateZone.mockResolvedValue(undefined)
  deleteZone.mockReset()
  deleteZone.mockResolvedValue(undefined)
  setZoneActual.mockReset()
  setZoneActual.mockResolvedValue(2)
})

// Wrapped in antd's App because src/App.tsx wraps the whole tree in it, and
// App.useApp()'s `message` is how the writes report what they did. Outside the
// provider that hook hands back an object with no methods, and the call throws.
const renderPanel = (editable = true) => render(
  <AntApp><DeckProgressPanel deckId="d1" editable={editable} /></AntApp>,
)

/** The stage the left lens is showing, by name. */
const pickLens = async (label: string, name: string) => {
  await userEvent.click(screen.getByLabelText(label))
  await userEvent.click(await screen.findByTitle(name))
}

describe('DeckProgressPanel', () => {
  it('loads the deck it was given', async () => {
    renderPanel()
    await waitFor(() => expect(loadDeckProgress).toHaveBeenCalledWith('d1'))
  })

  it('opens on one coat, over the deck\'s own drawing', async () => {
    renderPanel()
    // The first coat, because it is the one every deck has and the one the work
    // starts at. The panel used to open on a fixed pair -- paint on the left,
    // scaffolding on the right -- which spent half the screen on the last row
    // of the stage table and gave the middle coats no view at all.
    expect(await screen.findByTestId('lens-A')).toBeInTheDocument()
    expect(screen.queryByTestId('lens-B')).not.toBeInTheDocument()
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-image', 'https://signed/p1/d1.png')
    expect(within(screen.getByTestId('lens-A')).getByText('Tiến độ · Blast + Coat 1'))
      .toBeInTheDocument()
  })

  it('puts a second lens beside the first, on demand, sharing one zoom', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByText('So sánh hai lớp'))

    expect(await screen.findByTestId('lens-B')).toBeInTheDocument()
    // The ring is the single-lens companion. Two drawings and a ring in one row
    // leaves nothing wide enough to read.
    expect(screen.queryByTestId('stage-ring')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('lens-B')).getByText(/cùng mức zoom để so sánh/))
      .toBeInTheDocument()
  })

  it('drives both lenses from one zoom control', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    expect(screen.getByText('100%')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
    expect(screen.getByText('150%')).toBeInTheDocument()
  })

  it('shows the deck\'s own spec table', async () => {
    renderPanel()
    expect(await screen.findByTestId('deck-spec')).toBeInTheDocument()
  })

  it('breaks the deck down by the coat each bay is sitting at', async () => {
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    // Not cumulative, unlike every percentage elsewhere on the screen: this
    // answers "where is the work sitting right now", which the weighted deck
    // figure in the header above cannot.
    expect(within(ring).getByText('Coat 2')).toBeInTheDocument()
    expect(within(ring).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(ring).getAllByText('50,00%')).toHaveLength(2)
  })

  it('tells the admin when a deck has no drawing, instead of an empty frame', async () => {
    loadDeckProgress.mockResolvedValue({ ...ENTRY, imagePath: null })
    renderPanel()
    expect(await screen.findByText('Chưa có gì để hiển thị')).toBeInTheDocument()
    expect(screen.queryByTestId('lens-A')).not.toBeInTheDocument()
  })

  it('surfaces a load failure rather than rendering nothing', async () => {
    loadDeckProgress.mockRejectedValue(new Error('mạng hỏng'))
    renderPanel()
    expect(await screen.findByText('mạng hỏng')).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — colouring one coat', () => {
  beforeEach(() => {
    listDeckZones.mockResolvedValue([ZONE])
  })

  it('colours a bay by its zone where the coat has a plan', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    // ZONE covers c1 only, on s3.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#eb2f96'))
  })

  it('falls back to the coat\'s own colour for a bay outside every zone', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    // A zone-only rule leaves an unplanned deck blank, which is most decks
    // before the plan is drawn. The fill still says "which group"; the hatch
    // still says "not there yet".
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#722ed1'))
  })

  it('hatches exactly the bays that have not reached the coat being viewed', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    // c1 is AT Tháo giáo, c2 is at Coat 2 and has not got there.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-hatched', 'false'))
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-hatched', 'true')
  })

  it('hatches nothing at a coat both bays are already past', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    // Cumulative: a bay at Tháo giáo has been through Blast + Coat 1.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-hatched', 'false'))
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-hatched', 'false')
  })

  it('says what the hatch means, rather than leaving it to be inferred', async () => {
    renderPanel()
    expect(await screen.findByText(/ô chưa đạt lớp này có gạch chéo mờ/)).toBeInTheDocument()
  })

  it('counts each zone against the coat being viewed', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')

    const lens = await screen.findByTestId('lens-A')
    expect(within(lens).getByText('Khu A — Tháo giáo')).toBeInTheDocument()
    // One bay in the zone, and it has reached the coat.
    expect(within(lens).getByText('01/1')).toBeInTheDocument()
    expect(within(lens).getByText('Tiến độ từng zone · Tháo giáo')).toBeInTheDocument()
    expect(within(lens).getByText('1 / 2 ô')).toBeInTheDocument()
  })

  it('hides the zones of every other coat', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    // ZONE is planned against s3; the lens opens on s1.
    expect(await screen.findByText(/chưa có zone nào được lên kế hoạch/)).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — zones', () => {
  it('will not offer to group when nothing is selected', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    expect(screen.queryByRole('button', { name: /Gộp thành zone/ })).not.toBeInTheDocument()
  })

  it('creates one zone per coat that was given dates, from one dialog', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByTestId('band-all'))
    await userEvent.click(await screen.findByRole('button', { name: /Gộp thành zone/ }))

    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.type(screen.getByLabelText('Bắt đầu Coat 2'), '01/09/2026')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(createZone).toHaveBeenCalledTimes(1))
    expect(createZone.mock.calls[0][1]).toMatchObject({
      name: 'Khu A — Coat 2', stageId: 's2', startDate: '2026-09-01',
    })
    expect(createZone.mock.calls[0][2]).toEqual(['c1', 'c2'])
  })

  it('refuses a zone with no dates at all, rather than writing five empty ones', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByTestId('band-all'))
    await userEvent.click(await screen.findByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    expect(await screen.findByText(/Đặt ít nhất một mốc ngày/)).toBeInTheDocument()
    expect(createZone).not.toHaveBeenCalled()
  })

  it('clears the selection and re-reads the plan after creating', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByTestId('band-all'))
    await userEvent.click(await screen.findByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.type(screen.getByLabelText('Bắt đầu Coat 2'), '01/09/2026')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Gộp thành zone/ })).not.toBeInTheDocument())
  })

  it('edits a zone date in place, without remaking the zone', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')

    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    const finish = await screen.findByLabelText('Ngày kết thúc của Khu A — Tháo giáo')
    await userEvent.clear(finish)
    await userEvent.type(finish, '20/09/2026')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { finishDate: '2026-09-20' }))
    expect(createZone).not.toHaveBeenCalled()
    expect(deleteZone).not.toHaveBeenCalled()
  })

  it('writes the zone\'s stage across its bays on Ghi thực tế, and re-reads the deck', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ghi thực tế' }))

    await waitFor(() => expect(setZoneActual).toHaveBeenCalledWith('z1', 's3'))
    await waitFor(() => expect(loadDeckProgress).toHaveBeenCalledTimes(2))
  })

  it('names what a zone deletion does and does not destroy, before doing it', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Xoá zone' }))

    expect(await screen.findByText('Xoá zone Khu A — Tháo giáo?')).toBeInTheDocument()
    expect(screen.getByText(/Tiến độ GS đã ghi trên các ô vẫn giữ nguyên/)).toBeInTheDocument()
    expect(deleteZone).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Vẫn xoá' }))
    await waitFor(() => expect(deleteZone).toHaveBeenCalledWith('z1'))
  })

  it('surfaces a failed Ghi thực tế instead of leaving the plan looking applied', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    setZoneActual.mockRejectedValue(new Error('không ghi được'))
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ghi thực tế' }))

    expect(await screen.findByText('không ghi được')).toBeInTheDocument()
  })

  it('says so when the coat being viewed has no plan yet', async () => {
    renderPanel()
    expect(await screen.findByText(/chưa có zone nào được lên kế hoạch/)).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — read-only', () => {
  beforeEach(() => {
    listDeckZones.mockResolvedValue([ZONE])
  })

  it('shows the drawing, the plan and the numbers without entering edit', async () => {
    renderPanel(false)
    expect(await screen.findByTestId('lens-A')).toBeInTheDocument()
    expect(screen.getByTestId('deck-spec')).toBeInTheDocument()
    expect(screen.getByTestId('stage-ring')).toBeInTheDocument()
  })

  it('still lets the coat be changed, because looking changes nothing', async () => {
    renderPanel(false)
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    expect(await screen.findByText('Tiến độ · Tháo giáo')).toBeInTheDocument()
  })

  it('offers no way to select bays or make a zone', async () => {
    renderPanel(false)
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByTestId('cell-R1C1'))
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-selected', 'false')
    expect(screen.queryByRole('button', { name: /Gộp thành zone/ })).not.toBeInTheDocument()
  })

  it('shows a zone\'s plan as a readout, with nothing to press', async () => {
    renderPanel(false)
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')

    const lens = await screen.findByTestId('lens-A')
    expect(within(lens).getByText('01/09 – 07/09')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' })).toBeNull()
  })

  it('keeps every write available in edit mode', async () => {
    renderPanel(true)
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    expect(
      await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }),
    ).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — the foreman\'s note', () => {
  const NOTED = {
    ...ENTRY,
    deck: {
      ...ENTRY.deck,
      cells: [
        { ...ENTRY.deck.cells[0], note: 'Bề mặt còn ẩm, hoãn sơn sang mai' },
        ENTRY.deck.cells[1],
      ],
    },
    audit: { c1: { updatedBy: 'u1', updatedAt: '2026-08-29T11:47:00Z' } },
  }

  it('flags the bay that carries a note, and only that one', async () => {
    loadDeckProgress.mockResolvedValue(NOTED)
    renderPanel(false)
    await waitFor(() => expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-marked', 'true'))
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-marked', 'false')
  })

  it('shows what the foreman wrote, with who wrote it and when', async () => {
    loadDeckProgress.mockResolvedValue(NOTED)
    renderPanel(false)
    await userEvent.click(await screen.findByTestId('cell-R1C1'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Bề mặt còn ẩm, hoãn sơn sang mai')).toBeInTheDocument()
    // The coat it was recorded at, who recorded it, and when -- a note with no
    // attribution is a sentence the admin cannot follow up on.
    expect(await within(dialog).findByText(/Tháo giáo · Lê Trung Hiếu · 29\.08\.2026/))
      .toBeInTheDocument()
  })

  it('opens nothing for a bay with no note', async () => {
    loadDeckProgress.mockResolvedValue(NOTED)
    renderPanel(false)
    await userEvent.click(await screen.findByTestId('cell-R1C2'))
    expect(screen.queryByText(/Ghi chú · ô/)).not.toBeInTheDocument()
  })

  it('still selects bays while editing, rather than opening the note', async () => {
    loadDeckProgress.mockResolvedValue(NOTED)
    renderPanel(true)
    await userEvent.click(await screen.findByTestId('cell-R1C1'))
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-selected', 'true')
    expect(screen.queryByText('Bề mặt còn ẩm, hoãn sơn sang mai')).not.toBeInTheDocument()
  })
})
