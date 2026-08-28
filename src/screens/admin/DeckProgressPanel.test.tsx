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
vi.mock('../../lib/gsApi', () => ({
  listDeckZones: (d: string) => listDeckZones(d),
}))
vi.mock('../../lib/zonesApi', () => ({
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
    imageUrl, cells, cellColors, planLabels, selectedCodes, onCellClick, onSelectDraw,
  }: {
    imageUrl: string
    cells: { code: string }[]
    cellColors?: Record<string, string>
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

describe('DeckProgressPanel', () => {
  it('loads the deck it was given', async () => {
    renderPanel()
    await waitFor(() => expect(loadDeckProgress).toHaveBeenCalledWith('d1'))
  })

  it('draws the paint lens and the scaffolding lens over the same drawing', async () => {
    renderPanel()

    const paint = await screen.findByTestId('paint-lens')
    const scaffold = screen.getByTestId('scaffold-lens')

    // Paint colours by the coat reached.
    expect(within(paint).getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#722ed1')
    expect(within(paint).getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#bfbfbf')
    // Scaffolding answers a different question: only the bay at the LAST stage
    // is struck, so R1C2 -- well along on paint -- is still blocked.
    expect(within(scaffold).getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#722ed1')
    expect(within(scaffold).getByTestId('cell-R1C2')).not.toHaveAttribute('data-color', '#722ed1')

    await waitFor(() => {
      expect(within(paint).getByTestId('canvas'))
        .toHaveAttribute('data-image', 'https://signed/p1/d1.png')
    })
  })

  it('names every colour on both lenses', async () => {
    renderPanel()

    const paintKey = await screen.findByTestId('paint-legend')
    for (const name of ['Blast + Coat 1', 'Coat 2', 'Tháo giáo', 'Chưa bắt đầu']) {
      expect(within(paintKey).getByText(name)).toBeInTheDocument()
    }
    const scaffoldKey = screen.getByTestId('scaffold-legend')
    expect(within(scaffoldKey).getByText('Đã tháo giáo')).toBeInTheDocument()
    expect(within(scaffoldKey).getByText('Chưa tháo giáo')).toBeInTheDocument()
  })

  it('shows the deck\'s own spec table', async () => {
    renderPanel()
    const spec = await screen.findByTestId('deck-spec')
    // antd renders a fixed-column header twice -- once to measure.
    expect(within(spec).getAllByText('Tháo giáo').length).toBeGreaterThan(0)
    expect(within(spec).getAllByText('50,00%').length).toBeGreaterThan(0)
  })

  it('tells the admin when a deck has no drawing, instead of an empty frame', async () => {
    loadDeckProgress.mockResolvedValue({ ...ENTRY, imagePath: null, imageW: null, imageH: null })
    renderPanel()
    expect(await screen.findByText('Sàn này chưa có bản vẽ')).toBeInTheDocument()
    expect(getDrawingUrl).not.toHaveBeenCalled()
  })

  it('surfaces a load failure rather than rendering nothing', async () => {
    loadDeckProgress.mockRejectedValue(new Error('permission denied for table decks'))
    renderPanel()
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — zones', () => {
  it('will not offer to group when nothing is selected', async () => {
    renderPanel()
    await screen.findByTestId('paint-lens')
    expect(screen.getByRole('button', { name: /Gộp thành zone/ })).toBeDisabled()
  })

  it('creates one zone per coat that was given dates, from one dialog', async () => {
    // A zone's cell membership does not move between coats, so picking the same
    // bays five times to say when each coat happens was five times the work for
    // one decision. The schema is unchanged -- a zone row is still one stage
    // over one window; what changed is that the admin declares them together.
    renderPanel()
    await screen.findByTestId('paint-lens')

    await userEvent.click(within(screen.getByTestId('paint-lens')).getByTestId('band-all'))
    await userEvent.click(screen.getByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')

    await userEvent.click(screen.getByLabelText('Bắt đầu Blast + Coat 1'))
    await userEvent.click(await screen.findByTitle('2026-09-01'))
    await userEvent.click(screen.getByLabelText('Kết thúc Tháo giáo'))
    // Within the grid the picker opens on -- it shows the current month plus
    // the days either side that complete the six-week block. `findAllByTitle`
    // and the last match: antd leaves the first picker's panel mounted, so the
    // same date exists twice in the DOM and only the newest one is live.
    const cells = await screen.findAllByTitle('2026-09-05')
    await userEvent.click(cells[cells.length - 1])

    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(createZone).toHaveBeenCalledTimes(2))
    const names = createZone.mock.calls.map((c) => (c[1] as { name: string }).name)
    // Suffixed per coat: five rows called "Khu A" name nothing.
    expect(names).toEqual(['Khu A — Blast + Coat 1', 'Khu A — Tháo giáo'])
    const stageIds = createZone.mock.calls.map((c) => (c[1] as { stageId: string }).stageId)
    expect(stageIds).toEqual(['s1', 's3'])
    // Every zone gets the SAME bays -- ids, not codes.
    for (const call of createZone.mock.calls) expect(call[2]).toEqual(['c1', 'c2'])
  })

  it('creates nothing for a coat left blank', async () => {
    // Blank means "not planned yet", which is a different statement from
    // planning it for an unknown window.
    renderPanel()
    await screen.findByTestId('paint-lens')
    await userEvent.click(within(screen.getByTestId('paint-lens')).getByTestId('band-all'))
    await userEvent.click(screen.getByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')

    await userEvent.click(screen.getByLabelText('Bắt đầu Coat 2'))
    await userEvent.click(await screen.findByTitle('2026-09-05'))
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(createZone).toHaveBeenCalledTimes(1))
    expect((createZone.mock.calls[0][1] as { stageId: string }).stageId).toBe('s2')
  })

  it('refuses a zone with no dates at all, rather than writing five empty ones', async () => {
    renderPanel()
    await screen.findByTestId('paint-lens')
    await userEvent.click(within(screen.getByTestId('paint-lens')).getByTestId('band-all'))
    await userEvent.click(screen.getByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')

    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    expect(await screen.findByText(/ít nhất một mốc ngày/)).toBeInTheDocument()
    expect(createZone).not.toHaveBeenCalled()
  })

  it('clears the selection and re-reads the plan after creating', async () => {
    renderPanel()
    await screen.findByTestId('paint-lens')
    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(1))

    await userEvent.click(within(screen.getByTestId('paint-lens')).getByTestId('band-all'))
    await userEvent.click(screen.getByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.click(screen.getByLabelText('Bắt đầu Coat 2'))
    await userEvent.click(await screen.findByTitle('2026-09-05'))
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(within(screen.getByTestId('paint-lens')).getByTestId('cell-R1C1'))
        .toHaveAttribute('data-selected', 'false')
    })
  })

  it('writes no text on the drawing, and names the zone in the table instead', async () => {
    // A label per bay is two hundred labels over the plan the admin is trying to
    // read -- which is what a date range, and then a short marker, both became.
    // The colour says which group a bay is in; the table says which group that
    // is. The GS screen still labels bays, because a foreman has no table.
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()

    const table = await screen.findByTestId('zone-table')
    expect(within(table).getByText('Khu A — Tháo giáo')).toBeInTheDocument()
    expect(within(table).getByText('01/09 – 07/09')).toBeInTheDocument()
    expect(within(screen.getByTestId('paint-lens')).getByTestId('cell-R1C1'))
      .toHaveAttribute('data-plan', '')
  })

  it('edits a zone date in place, without remaking the zone', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('zone-table')

    await userEvent.click(screen.getByLabelText('Ngày bắt đầu của Khu A — Tháo giáo'))
    await userEvent.click(await screen.findByTitle('2026-09-03'))

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { startDate: '2026-09-03' }))
    expect(createZone).not.toHaveBeenCalled()
    expect(deleteZone).not.toHaveBeenCalled()
  })

  it('writes the zone\'s stage across its bays on Ghi thực tế, and re-reads the deck', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('zone-table')
    await waitFor(() => expect(loadDeckProgress).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: 'Ghi thực tế' }))

    await waitFor(() => expect(setZoneActual).toHaveBeenCalledWith('z1', 's3'))
    await waitFor(() => expect(loadDeckProgress).toHaveBeenCalledTimes(2))
  })

  it('deletes a zone and re-reads the list', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('zone-table')

    await userEvent.click(screen.getByRole('button', { name: 'Xoá' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Xoá zone' }))

    await waitFor(() => expect(deleteZone).toHaveBeenCalledWith('z1'))
    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
  })

  it('surfaces a failed Ghi thực tế instead of leaving the plan looking applied', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    setZoneActual.mockRejectedValue(new Error('stage does not belong to deck'))
    renderPanel()
    await screen.findByTestId('zone-table')

    await userEvent.click(screen.getByRole('button', { name: 'Ghi thực tế' }))

    expect(await screen.findByText(/stage does not belong to deck/)).toBeInTheDocument()
  })

  it('says so when a deck has no plan yet', async () => {
    renderPanel()
    expect(await screen.findByText('Sàn này chưa có zone nào')).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — filtering to one coat', () => {
  const zone = (id: string, name: string, stageId: string, cellIds: string[]) => ({
    id, name, stageId, startDate: '2026-09-01', finishDate: '2026-09-07', cellIds,
  })

  beforeEach(() => {
    listDeckZones.mockResolvedValue([
      zone('z1', 'Khu A — Coat 2', 's2', ['c1']),
      zone('z2', 'Khu B — Coat 2', 's2', ['c2']),
      zone('z3', 'Khu C — Tháo giáo', 's3', ['c1', 'c2']),
    ])
  })

  it('colours by the coat reached until a coat is chosen', async () => {
    renderPanel()
    const paint = await screen.findByTestId('paint-lens')
    expect(within(paint).getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#722ed1')
  })

  it('colours by planned group once a coat is chosen, each zone its own', async () => {
    // The coat is already fixed by the filter, so painting every bay one
    // constant stage colour would say nothing. The question becomes "which
    // group is this bay in, and how does it sit against its neighbours".
    renderPanel()
    await screen.findByTestId('paint-lens')

    await userEvent.click(screen.getByRole('combobox', { name: 'Lọc theo lớp sơn' }))
    await userEvent.click(await screen.findByTitle('Coat 2'))

    const paint = screen.getByTestId('paint-lens')
    const a = within(paint).getByTestId('cell-R1C1').getAttribute('data-color')
    const b = within(paint).getByTestId('cell-R1C2').getAttribute('data-color')
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    // Two zones on this coat, and they must be told apart.
    expect(a).not.toBe(b)
    // And not the stage's own colour, which is what the filter replaced.
    expect(a).not.toBe('#bfbfbf')
  })

  it('hides the zones of every other coat', async () => {
    // z3 covers both bays but belongs to Tháo giáo. Left in it would colour the
    // whole deck and describe a plan the admin is not looking at -- and its row
    // would claim a swatch the drawing never shows.
    renderPanel()
    await screen.findByTestId('paint-lens')

    await userEvent.click(screen.getByRole('combobox', { name: 'Lọc theo lớp sơn' }))
    await userEvent.click(await screen.findByTitle('Coat 2'))

    const key = screen.getByTestId('paint-legend')
    expect(within(key).getByText('Khu A — Coat 2')).toBeInTheDocument()
    expect(within(key).queryByText('Khu C — Tháo giáo')).toBeNull()
    const table = screen.getByTestId('zone-table')
    // Every zone stays listed -- the filter is about the drawing, not the plan.
    expect(within(table).getByText('Khu C — Tháo giáo')).toBeInTheDocument()
    // But only the drawn ones carry a swatch to match against it.
    expect(within(table).getByLabelText('Màu của Khu A — Coat 2')).toBeInTheDocument()
    expect(within(table).queryByLabelText('Màu của Khu C — Tháo giáo')).toBeNull()
  })

  it('swaps the key to name the zones it is drawing', async () => {
    // Filtered, the stage colours would name something the canvas is not
    // drawing at all.
    renderPanel()
    await screen.findByTestId('paint-lens')

    await userEvent.click(screen.getByRole('combobox', { name: 'Lọc theo lớp sơn' }))
    await userEvent.click(await screen.findByTitle('Coat 2'))

    const key = screen.getByTestId('paint-legend')
    expect(within(key).getByText('Khu A — Coat 2')).toBeInTheDocument()
    expect(within(key).getByText('Khu B — Coat 2')).toBeInTheDocument()
    expect(within(key).queryByText('Chưa bắt đầu')).toBeNull()
  })

  it('says so when the chosen coat has no plan yet', async () => {
    // The fixture zones sit on Coat 2 and Tháo giáo; the first coat has none.
    renderPanel()
    await screen.findByTestId('paint-lens')

    await userEvent.click(screen.getByRole('combobox', { name: 'Lọc theo lớp sơn' }))
    await userEvent.click(await screen.findByTitle('Blast + Coat 1'))

    expect(await screen.findByText(/chưa có zone nào được lên kế hoạch/)).toBeInTheDocument()
  })

  it('leaves the scaffolding lens alone', async () => {
    // It answers a different question and is not what the filter is about.
    renderPanel()
    await screen.findByTestId('scaffold-lens')

    await userEvent.click(screen.getByRole('combobox', { name: 'Lọc theo lớp sơn' }))
    await userEvent.click(await screen.findByTitle('Coat 2'))

    const scaffold = screen.getByTestId('scaffold-lens')
    expect(within(scaffold).getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#722ed1')
  })
})

describe('DeckProgressPanel — read-only', () => {
  // The admin's complaint, and it was fair: the deck's view showed five lines of
  // text, and seeing the drawing at all meant pressing "Sửa". Looking is not
  // editing. Everything is on the page now; only the writes are behind the
  // button.
  beforeEach(() => {
    listDeckZones.mockResolvedValue([ZONE])
  })

  it('shows the drawing, both lenses and the numbers without entering edit', async () => {
    renderPanel(false)

    expect(await screen.findByTestId('paint-lens')).toBeInTheDocument()
    expect(screen.getByTestId('scaffold-lens')).toBeInTheDocument()
    expect(screen.getByTestId('deck-spec')).toBeInTheDocument()
    expect(screen.getByTestId('zone-table')).toBeInTheDocument()
  })

  it('still lets the lens be filtered, because filtering changes nothing', async () => {
    renderPanel(false)
    await screen.findByTestId('paint-lens')
    expect(screen.getByRole('combobox', { name: 'Lọc theo lớp sơn' })).toBeInTheDocument()
  })

  it('offers no way to select bays or make a zone', async () => {
    renderPanel(false)
    await screen.findByTestId('paint-lens')

    expect(screen.queryByRole('button', { name: /Gộp thành zone/ })).toBeNull()
    // And a tap on a bay selects nothing: the canvas gets no click handler at
    // all, so there is no half-state where bays highlight and nothing can be
    // done with them.
    await userEvent.click(within(screen.getByTestId('paint-lens')).getByTestId('cell-R1C1'))
    expect(within(screen.getByTestId('paint-lens')).getByTestId('cell-R1C1'))
      .toHaveAttribute('data-selected', 'false')
  })

  it('shows the zone dates as text rather than as editable fields', async () => {
    renderPanel(false)
    const table = await screen.findByTestId('zone-table')

    expect(within(table).queryByLabelText(/Ngày bắt đầu của/)).toBeNull()
    // The dates are still READ, in the form the source drawings use.
    expect(within(table).getByText('01/09')).toBeInTheDocument()
    expect(within(table).getByText('07/09')).toBeInTheDocument()
  })

  it('offers neither Ghi thực tế nor Xoá', async () => {
    renderPanel(false)
    await screen.findByTestId('zone-table')

    expect(screen.queryByRole('button', { name: 'Ghi thực tế' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xoá' })).toBeNull()
  })

  it('keeps every write available in edit mode', async () => {
    renderPanel(true)
    await screen.findByTestId('zone-table')

    expect(screen.getByRole('button', { name: /Gộp thành zone/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ghi thực tế' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ngày bắt đầu của Khu A — Tháo giáo')).toBeInTheDocument()
  })
})
