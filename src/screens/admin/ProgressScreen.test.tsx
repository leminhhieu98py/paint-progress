import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressScreen } from './ProgressScreen'

const listProjectNames = vi.hoisted(() => vi.fn())
const loadProjectProgress = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())

vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))
vi.mock('../../lib/progressApi', () => ({
  loadProjectProgress: (id: string) => loadProjectProgress(id),
}))
vi.mock('../../lib/decksApi', () => ({
  getDrawingUrl: (p: string) => getDrawingUrl(p),
}))

// Konva renders to a canvas, which jsdom does not implement. The double exposes
// the two things this screen is responsible for putting on a canvas: which
// drawing, and what colour each bay came out.
vi.mock('../../canvas/DrawingCanvas', () => ({
  DrawingCanvas: ({
    imageUrl, cells, cellColors,
  }: {
    imageUrl: string
    cells: { code: string }[]
    cellColors?: Record<string, string>
  }) => (
    <div data-testid="canvas" data-image={imageUrl}>
      {cells.map((c) => (
        <span key={c.code} data-testid={`cell-${c.code}`} data-color={cellColors?.[c.code] ?? ''} />
      ))}
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
})

describe('ProgressScreen', () => {
  it('opens the first project and its first deck', async () => {
    render(<ProgressScreen />)

    await waitFor(() => expect(loadProjectProgress).toHaveBeenCalledWith('p1'))
    expect(await screen.findByRole('tab', { name: 'Cellar Deck' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Main Deck' })).toBeInTheDocument()
  })

  it('draws the paint lens and the scaffolding lens side by side, on the same deck', async () => {
    render(<ProgressScreen />)

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
    render(<ProgressScreen />)

    await waitFor(() => {
      expect(within(screen.getByTestId('paint-lens')).getByTestId('canvas'))
        .toHaveAttribute('data-image', 'https://signed/p1/d1.png')
    })
    expect(within(screen.getByTestId('scaffold-lens')).getByTestId('canvas'))
      .toHaveAttribute('data-image', 'https://signed/p1/d1.png')
  })

  it('switches both lenses when the deck tab changes', async () => {
    render(<ProgressScreen />)
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
    render(<ProgressScreen />)

    const rollup = await screen.findByTestId('project-rollup')
    expect(within(rollup).getByText('70,00%')).toBeInTheDocument()
    expect(within(rollup).getByText('6,25%')).toBeInTheDocument()
    expect(within(rollup).getByText('38,13%')).toBeInTheDocument()
  })

  it('shows the open deck\'s own spec table, not the project\'s', async () => {
    // Stages are per deck since 0018. The table names the stages of whichever
    // deck is open, and its numbers divide by that deck's declared area.
    render(<ProgressScreen />)

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
    render(<ProgressScreen />)

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
    render(<ProgressScreen />)

    expect(await screen.findByText('Sàn này chưa có bản vẽ')).toBeInTheDocument()
    expect(getDrawingUrl).not.toHaveBeenCalled()
  })

  it('surfaces a load failure rather than rendering an empty project', async () => {
    loadProjectProgress.mockRejectedValue(new Error('permission denied for table decks'))
    render(<ProgressScreen />)

    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
  })

  it('says so when the project has no decks yet', async () => {
    loadProjectProgress.mockResolvedValue([])
    render(<ProgressScreen />)

    expect(await screen.findByText('Dự án này chưa có sàn nào')).toBeInTheDocument()
  })

  it('reloads when the admin picks another project', async () => {
    listProjectNames.mockResolvedValue([
      { id: 'p1', name: 'BB1 - CPPTS', code: 'BB1' },
      { id: 'p2', name: 'BB2', code: 'BB2' },
    ])
    render(<ProgressScreen />)
    await waitFor(() => expect(loadProjectProgress).toHaveBeenCalledWith('p1'))

    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByText('BB2 (BB2)'))

    await waitFor(() => expect(loadProjectProgress).toHaveBeenCalledWith('p2'))
  })
})
