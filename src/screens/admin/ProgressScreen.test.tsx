import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressScreen } from './ProgressScreen'

const listProjectNames = vi.hoisted(() => vi.fn())
const loadProjectProgress = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const createZone = vi.hoisted(() => vi.fn())
const updateZone = vi.hoisted(() => vi.fn())
const deleteZone = vi.hoisted(() => vi.fn())
const setZoneActual = vi.hoisted(() => vi.fn())
const buildReportWorkbook = vi.hoisted(() => vi.fn())

vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))
vi.mock('../../lib/progressApi', () => ({
  loadProjectProgress: (id: string) => loadProjectProgress(id),
}))
vi.mock('../../lib/decksApi', () => ({
  getDrawingUrl: (p: string) => getDrawingUrl(p),
}))
vi.mock('../../lib/gsApi', () => ({
  listDeckZones: (d: string) => listDeckZones(d),
}))
vi.mock('../../lib/reportXlsx', () => ({
  buildReportWorkbook: (i: unknown) => buildReportWorkbook(i),
  reportFileName: (c: string, d: string) => `tien-do-${c}-${d}.xlsx`,
}))
vi.mock('../../lib/zonesApi', () => ({
  createZone: (d: string, draft: unknown, ids: string[]) => createZone(d, draft, ids),
  updateZone: (id: string, f: unknown) => updateZone(id, f),
  deleteZone: (id: string) => deleteZone(id),
  setZoneActual: (id: string, s: string) => setZoneActual(id, s),
}))

// Konva renders to a canvas, which jsdom does not implement. The double exposes
// the two things this screen is responsible for putting on a canvas: which
// drawing, and what colour each bay came out.
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
      <button
        data-testid="band-all"
        onClick={() => onSelectDraw?.({ x: 0, y: 0, w: 1, h: 1 })}
      />
    </div>
  ),
}))

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]

/** Two decks of 1000 m². CD has one 500 m² bay at Tháo giáo and one at Coat 2;
 *  MD has one 250 m² bay at Blast + Coat 1 and nothing else. */
const ENTRIES = [
  {
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
  },
  {
    seq: 2,
    deck: {
      id: 'd2', code: 'MD', name: 'Main Deck', totalAreaM2: 1000,
      cells: [
        { id: 'c9', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 250, stageId: 's1' },
      ],
    },
    stages: STAGES,
    imagePath: 'p1/d2.png', imageW: 2000, imageH: 1600,
  },
]

beforeEach(() => {
  listProjectNames.mockReset()
  loadProjectProgress.mockReset()
  getDrawingUrl.mockReset()
  listProjectNames.mockResolvedValue([{ id: 'p1', name: 'BB1 - CPPTS', code: 'BB1' }])
  loadProjectProgress.mockResolvedValue(ENTRIES)
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
  buildReportWorkbook.mockReset()
  buildReportWorkbook.mockResolvedValue(new Blob(['x']))
})

// Wrapped in antd's App because src/App.tsx wraps the whole tree in it, and
// because App.useApp()'s `message` is how "Ghi thực tế" reports how many bays it
// wrote. Outside the provider that hook hands back an object with no methods,
// and the call throws -- which a bare render() would have shipped.
const renderScreen = () => render(<AntApp><ProgressScreen /></AntApp>)

describe('ProgressScreen', () => {
  it('opens the first project and its first deck', async () => {
    renderScreen()

    await waitFor(() => expect(loadProjectProgress).toHaveBeenCalledWith('p1'))
    expect(await screen.findByRole('tab', { name: 'Cellar Deck' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Main Deck' })).toBeInTheDocument()
  })

  it('draws the paint lens and the scaffolding lens side by side, on the same deck', async () => {
    renderScreen()

    const paint = await screen.findByTestId('paint-lens')
    const scaffold = screen.getByTestId('scaffold-lens')

    // The paint lens colours by the stage reached: R1C1 is at Tháo giáo, R1C2
    // at Coat 2, and they are different colours.
    expect(within(paint).getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#722ed1')
    expect(within(paint).getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#bfbfbf')

    // The scaffolding lens answers a different question on the same data: only
    // the bay that reached the LAST stage counts as struck, so R1C2 -- well
    // along on paint -- is still scaffolded.
    expect(within(scaffold).getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#722ed1')
    expect(within(scaffold).getByTestId('cell-R1C2')).not.toHaveAttribute('data-color', '#722ed1')
  })

  it('shows both lenses over the same signed drawing', async () => {
    renderScreen()

    await waitFor(() => {
      expect(within(screen.getByTestId('paint-lens')).getByTestId('canvas'))
        .toHaveAttribute('data-image', 'https://signed/p1/d1.png')
    })
    expect(within(screen.getByTestId('scaffold-lens')).getByTestId('canvas'))
      .toHaveAttribute('data-image', 'https://signed/p1/d1.png')
  })

  it('switches both lenses when the deck tab changes', async () => {
    renderScreen()
    await screen.findByRole('tab', { name: 'Main Deck' })

    await userEvent.click(screen.getByRole('tab', { name: 'Main Deck' }))

    await waitFor(() => {
      expect(within(screen.getByTestId('paint-lens')).getByTestId('canvas'))
        .toHaveAttribute('data-image', 'https://signed/p1/d2.png')
    })
    // d2 has one bay at Blast + Coat 1; R1C2 exists only on d1.
    expect(within(screen.getByTestId('paint-lens')).getByTestId('cell-R1C1'))
      .toHaveAttribute('data-color', '#fadb14')
    expect(within(screen.getByTestId('paint-lens')).queryByTestId('cell-R1C2')).toBeNull()
  })

  it('rolls the project up, one row per deck plus a total', async () => {
    // CD: 500 m² at Tháo giáo (all three stages) + 500 at Coat 2 (first two).
    //   p1 = 1000/1000, p2 = 1000/1000, p3 = 500/1000
    //   prog = .25 + .15 + .6*.5 = 70,00%
    // MD: 250 m² at Blast + Coat 1 → prog = .25 * .25 = 6,25%
    // Equal areas, so the project is (70 + 6,25)/2 = 38,13%.
    renderScreen()

    const rollup = await screen.findByTestId('project-rollup')
    expect(within(rollup).getByText('70,00%')).toBeInTheDocument()
    expect(within(rollup).getByText('6,25%')).toBeInTheDocument()
    expect(within(rollup).getByText('38,13%')).toBeInTheDocument()
  })

  it('shows the open deck\'s own spec table, not the project\'s', async () => {
    // Stages are per deck since 0018. The table names the stages of whichever
    // deck is open, and its numbers divide by that deck's declared area.
    renderScreen()

    const spec = await screen.findByTestId('deck-spec')
    // getAllByText: antd renders a fixed-column header twice -- once to measure
    // -- so one stage name is legitimately present more than once in one table.
    expect(within(spec).getAllByText('Tháo giáo').length).toBeGreaterThan(0)
    expect(within(spec).getAllByText('50,00%').length).toBeGreaterThan(0)
  })

  it('names every colour on both lenses', async () => {
    // Driving the real deck, the two canvases were a wall of colour with nothing
    // saying what any of it meant: the admin had to know that grey was Coat 2
    // and not "untouched". Each lens carries its own key, and the scaffolding
    // one says what its two colours mean in words rather than by convention.
    renderScreen()

    const paintKey = await screen.findByTestId('paint-legend')
    for (const name of ['Blast + Coat 1', 'Coat 2', 'Tháo giáo', 'Chưa bắt đầu']) {
      expect(within(paintKey).getByText(name)).toBeInTheDocument()
    }

    const scaffoldKey = screen.getByTestId('scaffold-legend')
    expect(within(scaffoldKey).getByText('Đã tháo giáo')).toBeInTheDocument()
    expect(within(scaffoldKey).getByText('Chưa tháo giáo')).toBeInTheDocument()
  })

  it('tells the admin when a deck has no drawing, instead of an empty frame', async () => {
    loadProjectProgress.mockResolvedValue([
      { ...ENTRIES[0], imagePath: null, imageW: null, imageH: null },
    ])
    renderScreen()

    expect(await screen.findByText('Sàn này chưa có bản vẽ')).toBeInTheDocument()
    expect(getDrawingUrl).not.toHaveBeenCalled()
  })

  it('surfaces a load failure rather than rendering an empty project', async () => {
    loadProjectProgress.mockRejectedValue(new Error('permission denied for table decks'))
    renderScreen()

    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
  })

  it('says so when the project has no decks yet', async () => {
    loadProjectProgress.mockResolvedValue([])
    renderScreen()

    expect(await screen.findByText('Dự án này chưa có sàn nào')).toBeInTheDocument()
  })

  it('reloads when the admin picks another project', async () => {
    listProjectNames.mockResolvedValue([
      { id: 'p1', name: 'BB1 - CPPTS', code: 'BB1' },
      { id: 'p2', name: 'BB2', code: 'BB2' },
    ])
    renderScreen()
    await waitFor(() => expect(loadProjectProgress).toHaveBeenCalledWith('p1'))

    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByText('BB2 (BB2)'))

    await waitFor(() => expect(loadProjectProgress).toHaveBeenCalledWith('p2'))
  })
})

describe('ProgressScreen — zones', () => {
  const ZONE = {
    id: 'z1', name: 'Khu A', stageId: 's3',
    startDate: '2026-09-01', finishDate: '2026-09-07',
    cellIds: ['c1'],
  }

  it('groups the swept bays into a zone', async () => {
    renderScreen()
    await screen.findByTestId('paint-lens')

    // Shift-drag across the drawing, then group.
    await userEvent.click(within(screen.getByTestId('paint-lens')).getByTestId('band-all'))
    await userEvent.click(screen.getByRole('button', { name: /Gộp thành zone/ }))

    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(createZone).toHaveBeenCalledTimes(1))
    const [deckId, draft, cellIds] = createZone.mock.calls[0]
    expect(deckId).toBe('d1')
    expect(draft).toMatchObject({ name: 'Khu A' })
    // Ids, not codes: zone_cells references cells.id, and two decks can both
    // carry an R1C1.
    expect(cellIds).toEqual(['c1', 'c2'])
  })

  it('will not offer to group when nothing is selected', async () => {
    renderScreen()
    await screen.findByTestId('paint-lens')

    expect(screen.getByRole('button', { name: /Gộp thành zone/ })).toBeDisabled()
  })

  it('clears the selection after the zone is created, so the next sweep starts clean', async () => {
    renderScreen()
    await screen.findByTestId('paint-lens')
    await userEvent.click(within(screen.getByTestId('paint-lens')).getByTestId('band-all'))
    await userEvent.click(screen.getByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(createZone).toHaveBeenCalled())
    await waitFor(() => {
      expect(within(screen.getByTestId('paint-lens')).getByTestId('cell-R1C1'))
        .toHaveAttribute('data-selected', 'false')
    })
  })

  it('re-reads the zones after creating one, so the table is not stale', async () => {
    renderScreen()
    await screen.findByTestId('paint-lens')
    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(1))

    await userEvent.click(within(screen.getByTestId('paint-lens')).getByTestId('band-all'))
    await userEvent.click(screen.getByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
  })

  it('lists the deck\'s zones with their planned range', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderScreen()

    const table = await screen.findByTestId('zone-table')
    expect(within(table).getByText('Khu A')).toBeInTheDocument()
    // The range in the form the source drawings use.
    expect(within(table).getByText('01/09 – 07/09')).toBeInTheDocument()
  })

  it('labels the planned bays on the drawing, the way the foreman sees them', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderScreen()

    await waitFor(() => {
      expect(within(screen.getByTestId('paint-lens')).getByTestId('cell-R1C1'))
        .toHaveAttribute('data-plan', '01/09 – 07/09')
    })
  })

  it('writes the zone\'s stage across its bays on Set actual, and re-reads the deck', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderScreen()
    await screen.findByTestId('zone-table')
    await waitFor(() => expect(loadProjectProgress).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: 'Ghi thực tế' }))

    await waitFor(() => expect(setZoneActual).toHaveBeenCalledWith('z1', 's3'))
    // The percentages on this screen just changed; leaving them stale is the
    // defect the decks list had before its editor re-fetched on close.
    await waitFor(() => expect(loadProjectProgress).toHaveBeenCalledTimes(2))
  })

  it('edits a zone\'s start date in place, without remaking the zone', async () => {
    // Spec §8.5 asks for inline editing. Before this a date that slipped meant
    // deleting the zone and rebuilding it -- which loses its cell membership and
    // takes its plan off the foreman's drawing in between.
    listDeckZones.mockResolvedValue([ZONE])
    renderScreen()
    await screen.findByTestId('zone-table')

    await userEvent.click(screen.getByLabelText('Ngày bắt đầu của Khu A'))
    await userEvent.click(await screen.findByTitle('2026-09-03'))

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { startDate: '2026-09-03' }))
    expect(createZone).not.toHaveBeenCalled()
    expect(deleteZone).not.toHaveBeenCalled()
  })

  it('edits a zone\'s finish date in place', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderScreen()
    await screen.findByTestId('zone-table')

    await userEvent.click(screen.getByLabelText('Ngày kết thúc của Khu A'))
    await userEvent.click(await screen.findByTitle('2026-09-12'))

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { finishDate: '2026-09-12' }))
  })

  it('clears a date rather than leaving a stale one', async () => {
    // null is a value: it says the end is no longer known. A picker that could
    // only ever set a date would make a slipped zone impossible to express.
    listDeckZones.mockResolvedValue([ZONE])
    renderScreen()
    await screen.findByTestId('zone-table')

    const picker = screen.getByLabelText('Ngày kết thúc của Khu A')
    await userEvent.hover(picker)
    await userEvent.click(within(picker.closest('.ant-picker')!).getByRole('button', { hidden: true }))

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { finishDate: null }))
  })

  it('re-reads the plan after an inline edit, so the drawing labels follow', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderScreen()
    await screen.findByTestId('zone-table')
    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByLabelText('Ngày bắt đầu của Khu A'))
    await userEvent.click(await screen.findByTitle('2026-09-03'))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
  })

  it('surfaces a failed inline edit instead of showing the new date as saved', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    updateZone.mockRejectedValue(new Error('permission denied for table zones'))
    renderScreen()
    await screen.findByTestId('zone-table')

    await userEvent.click(screen.getByLabelText('Ngày bắt đầu của Khu A'))
    await userEvent.click(await screen.findByTitle('2026-09-03'))

    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
  })

  it('deletes a zone and re-reads the list', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderScreen()
    await screen.findByTestId('zone-table')

    await userEvent.click(screen.getByRole('button', { name: 'Xoá' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Xoá zone' }))

    await waitFor(() => expect(deleteZone).toHaveBeenCalledWith('z1'))
    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
  })

  it('surfaces a failed Set actual instead of leaving the plan looking applied', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    setZoneActual.mockRejectedValue(new Error('stage does not belong to deck'))
    renderScreen()
    await screen.findByTestId('zone-table')

    await userEvent.click(screen.getByRole('button', { name: 'Ghi thực tế' }))

    expect(await screen.findByText(/stage does not belong to deck/)).toBeInTheDocument()
  })

  it('says so when a deck has no plan yet', async () => {
    renderScreen()
    expect(await screen.findByText('Sàn này chưa có zone nào')).toBeInTheDocument()
  })
})

describe('ProgressScreen — export', () => {
  it('hands the report every deck of the project, with its own stages and plan', async () => {
    // Every deck, not just the one on screen: the Overview sheet is the whole
    // project, and exporting whichever tab happened to be open is the shape of
    // a report that quietly under-states the job.
    listDeckZones.mockResolvedValue([])
    renderScreen()
    await screen.findByTestId('paint-lens')

    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))

    await waitFor(() => expect(buildReportWorkbook).toHaveBeenCalledTimes(1))
    const [input] = buildReportWorkbook.mock.calls[0]
    expect(input.decks).toHaveLength(2)
    expect(input.decks.map((d: { deck: { code: string } }) => d.deck.code)).toEqual(['CD', 'MD'])
    expect(input.decks[0].stages).toEqual(STAGES)
  })

  it('collects each deck\'s own zones, not only the open deck\'s', async () => {
    listDeckZones.mockImplementation((deckId: string) => Promise.resolve(
      deckId === 'd2'
        ? [{ id: 'z9', name: 'Khu B', stageId: 's1', startDate: null, finishDate: null, cellIds: [] }]
        : [],
    ))
    renderScreen()
    await screen.findByTestId('paint-lens')

    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))

    await waitFor(() => expect(buildReportWorkbook).toHaveBeenCalled())
    const [input] = buildReportWorkbook.mock.calls[0]
    expect(input.decks[1].zones).toHaveLength(1)
    expect(input.decks[1].zones[0].name).toBe('Khu B')
  })

  it('surfaces a failed export instead of failing silently', async () => {
    buildReportWorkbook.mockRejectedValue(new Error('out of memory'))
    renderScreen()
    await screen.findByTestId('paint-lens')

    await userEvent.click(screen.getByRole('button', { name: /Xuất báo cáo/ }))

    expect(await screen.findByText(/out of memory/)).toBeInTheDocument()
  })
})
