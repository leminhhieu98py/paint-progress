import { App as AntApp, theme } from 'antd'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consequenceItems, expectHelperText, expectNoSpecIds, keyFactTexts, ruleTexts } from '../../test/copy'
import { expectOnScale, weightOf } from '../../test/typography'
import { adminTheme, palette, type } from '../../theme'
import { DECK_RING, figureFits, ringFigureStep } from '../../components/ringFit'
import { DeckProgressPanel } from './DeckProgressPanel'

const loadDeckWorks = vi.hoisted(() => vi.fn())
const listDeckEvents = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const createZone = vi.hoisted(() => vi.fn())
const updateZone = vi.hoisted(() => vi.fn())
const deleteZone = vi.hoisted(() => vi.fn())
const setZoneActual = vi.hoisted(() => vi.fn())
const setZoneCells = vi.hoisted(() => vi.fn())
const listCellNotes = vi.hoisted(() => vi.fn())
const setReportNote = vi.hoisted(() => vi.fn())
const subscribeDeckStates = vi.hoisted(() => vi.fn())

vi.mock('../../lib/progressApi', () => ({
  loadDeckWorks: (id: string) => loadDeckWorks(id),
  listDeckEvents: (id: string) => listDeckEvents(id),
  listCellNotes: (cellId: string) => listCellNotes(cellId),
  setReportNote: (id: number, note: string | null, hidden: boolean) => setReportNote(id, note, hidden),
}))
vi.mock('../../lib/decksApi', () => ({
  getDrawingUrl: (p: string) => getDrawingUrl(p),
}))
vi.mock('../../lib/adminApi', () => ({
  listGsUsers: () => Promise.resolve([{ id: 'u1', fullName: 'Lê Trung Hiếu' }]),
}))
vi.mock('../../lib/gsApi', () => ({
  subscribeDeckStates: (id: string, h: unknown) => subscribeDeckStates(id, h),
}))
vi.mock('../../lib/zonesApi', () => ({
  listDeckZones: (d: string) => listDeckZones(d),
  createZone: (d: string, draft: unknown, ids: string[], stages: unknown) => createZone(d, draft, ids, stages),
  updateZone: (id: string, f: unknown, stages?: unknown) =>
    (stages === undefined ? updateZone(id, f) : updateZone(id, f, stages)),
  deleteZone: (id: string) => deleteZone(id),
  setZoneActual: (id: string, s: string) => setZoneActual(id, s),
  setZoneCells: (id: string, ids: string[]) => setZoneCells(id, ids),
}))

/** How often the panel rendered a canvas: the ring's hover must not (m-4). */
const canvasRenders = vi.hoisted(() => ({ count: 0 }))

// Konva renders to a canvas, which jsdom does not implement. The double exposes
// what this panel is responsible for putting on one: which drawing, what colour
// each bay came out, what is selected, and what the plan says.
vi.mock('../../canvas/DrawingCanvas', () => ({
  DrawingCanvas: ({
    imageUrl, cells, cellColors, hatchedCodes, markedCodes, planLabels, selectedCodes,
    outlineColors, cellOpacities, zoneLabels, onCellClick, onSelectDraw,
  }: {
    imageUrl: string
    cells: { code: string }[]
    cellColors?: Record<string, string>
    outlineColors?: Record<string, string>
    cellOpacities?: Record<string, number>
    hatchedCodes?: string[]
    markedCodes?: string[]
    planLabels?: Record<string, string>
    zoneLabels?: { id: string; name: string }[]
    selectedCodes?: string[]
    onCellClick?: (code: string, additive: boolean) => void
    onSelectDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
  }) => {
    canvasRenders.count += 1
    return (
    <div
      data-testid="canvas"
      data-image={imageUrl}
      // The label boxes the panel asks for, as a count and as their names:
      // RV6-12 off and RV6-13 both have to draw none of them.
      data-labels={(zoneLabels ?? []).map((l) => l.name).join('|')}
    >
      {cells.map((c) => (
        <button
          key={c.code}
          data-testid={`cell-${c.code}`}
          data-color={cellColors?.[c.code] ?? ''}
          data-outline={outlineColors?.[c.code] ?? ''}
          data-opacity={String(cellOpacities?.[c.code] ?? '')}
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
    )
  },
}))

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]

const WORK = {
  id: 'w1', projectId: 'p1', seq: 1, name: 'Công việc chính', kind: 'bays' as const,
  weight: 1, counts: true, manualProgress: 0, quantityLabel: 'Diện tích', unit: 'm²',
}
/** The bays as the deck's one work sees them: 500 m² at Tháo giáo, 500 at Coat 2. */
const CELLS = [
  { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 500, stageId: 's3' },
  { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 500, stageId: 's2' },
]
/** 1000 m² deck in one work at weight 1 -- the shape 0024's backfill leaves. */
const ENTRY = {
  seq: 1,
  deck: {
    id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000,
    cells: CELLS.map((c) => ({ ...c, stageId: null })),
  },
  imagePath: 'p1/d1.png', imageW: 2000, imageH: 1600,
  areaSource: 'guides' as const,
  works: [{ work: WORK, weight: 1, stages: STAGES, cells: CELLS, audit: {} }],
}

const ZONE = {
  id: 'z1', name: 'Khu A — Tháo giáo', stageId: 's3', color: null,
  startDate: '2026-09-01', finishDate: '2026-09-07', cellIds: ['c1'],
}

beforeEach(() => {
  loadDeckWorks.mockReset()
  loadDeckWorks.mockResolvedValue(ENTRY)
  listDeckEvents.mockReset()
  listDeckEvents.mockResolvedValue([])
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
  setZoneCells.mockReset()
  setZoneCells.mockResolvedValue(undefined)
  subscribeDeckStates.mockReset()
  subscribeDeckStates.mockReturnValue(() => {})
  listCellNotes.mockReset()
  listCellNotes.mockResolvedValue([])
  setReportNote.mockReset()
  setReportNote.mockResolvedValue(undefined)
})

// Wrapped in antd's App because src/App.tsx wraps the whole tree in it, and
// App.useApp()'s `message` is how the writes report what they did. Outside the
// provider that hook hands back an object with no methods, and the call throws.
const renderPanel = (editable = true) => render(
  <AntApp><DeckProgressPanel deckId="d1" editable={editable} /></AntApp>,
)

/** The start input of one coat's RangePicker in the create-zone dialog. */
const startInputOf = (stageName: string) =>
  within(
    within(screen.getByTestId('stage-windows')).getByRole('row', { name: new RegExp(stageName) }),
  ).getByPlaceholderText('Bắt đầu')

/** Tìm in the bar that holds `el`: the lens bar is a draft (FLT-08). */
const applyBarOf = async (el: HTMLElement) => {
  const bar = el.closest('[role="search"]') as HTMLElement
  await userEvent.click(within(bar).getByRole('button', { name: /Tìm/ }))
}

/** A lens bar's select, by its label, set to `name` and applied with Tìm. */
const pickLens = async (label: string, name: string) => {
  await userEvent.click(screen.getByLabelText(label))
  await userEvent.click(await screen.findByTitle(name))
  await applyBarOf(screen.getByLabelText(label))
}

describe('DeckProgressPanel', () => {
  it('loads the deck it was given', async () => {
    renderPanel()
    await waitFor(() => expect(loadDeckWorks).toHaveBeenCalledWith('d1'))
  })

  it('shows the deck\'s progress and its zone count beside the coat card\'s title as KeyFacts (HLT-01)', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await waitFor(() => expect(keyFactTexts()).toHaveLength(2))
    const [progress, zones] = keyFactTexts()
    expect(progress).toMatch(/^\d+,\d{2}%$/)
    expect(zones).toBe('1 zone')
  })

  it('states its rules as helper text, with no spec id and no legend the lens (?) already gives (CPY-04, RUL-01)', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    expect(ruleTexts()).toEqual([
      'Xoá zone chỉ xoá kế hoạch và giữ nguyên tiến độ đã ghi trên các ô.',
      'Màu zone chọn trong bảng màu đã bỏ các màu lớp sơn của công việc trên sàn này.',
    ])
    expectHelperText(ruleTexts())
    expect(screen.queryByText(/A3\.2/)).not.toBeInTheDocument()
    expectNoSpecIds()
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

  it('starts both drawings on one line: each lens header holds a control\'s height (Q1)', async () => {
    // Ghi chú (n) is a default-height button in lens A's header alone; B's
    // header held only its title and put B's drawing 14px higher.
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByText('So sánh hai lớp'))
    await screen.findByTestId('lens-B')
    const titles = screen.getAllByRole('heading', { level: 3, name: /^Tiến độ · / })
    expect(titles).toHaveLength(2)
    const { controlHeight } = theme.getDesignToken()
    for (const h of titles) expect(h.parentElement).toHaveStyle({ minHeight: `${controlHeight}px` })
    // The button is the one control there, at the default height (CTL-01).
    const notes = screen.getByRole('button', { name: /^Ghi chú \(/ })
    expect(notes).not.toHaveClass('ant-btn-sm')
    expect(notes.parentElement).toBe(titles[0].parentElement!.parentElement)
  })

  it('puts a second lens beside the first, on demand, sharing one zoom', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByText('So sánh hai lớp'))

    expect(await screen.findByTestId('lens-B')).toBeInTheDocument()
    // The ring is the single-lens companion. Two drawings and a ring in one row
    // leaves nothing wide enough to read.
    expect(screen.queryByTestId('stage-ring')).not.toBeInTheDocument()
    // No side captions: each pane carries the legend on its title's (?),
    // like the single view (CPY-01).
    const lensB = screen.getByTestId('lens-B')
    expect(within(lensB).queryByText(/cùng mức zoom để so sánh/)).toBeNull()
    expect(within(lensB).getByRole('img', { name: /tô đặc/ })).toBeInTheDocument()
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

  it('numbers the works and per-coat sections as cards after the drawing panel (UX-03)', async () => {
    // They were boxes inside A3.4 and the only sections of the deck page
    // without a code. As A3.5 and A3.6 the page reads as one ordered list.
    renderPanel(false)
    await screen.findByTestId('deck-works-table')
    const [a4, a5, a6] = ['A3.4', 'A3.5', 'A3.6'].map((code) => screen.getByText(code))
    expect(a4.compareDocumentPosition(a5) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(a5.compareDocumentPosition(a6) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Sàn này theo từng công việc' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Diện tích cộng dồn theo công đoạn' })).toBeInTheDocument()
  })

  it('breaks the deck down by coat CUMULATIVELY, since a later coat implies the earlier ones', async () => {
    // Feedback Rv3, item 1. One 500 m² bay sits at Coat 2 and the other at
    // Tháo giáo, so the whole deck has been through Blast + Coat 1 and Coat 2
    // (100% each) and half of it through Tháo giáo (50%). The list used to
    // read 50% / 50% for the two coats a bay was SITTING on and nothing for
    // Blast + Coat 1 -- and Linh read that as the deck being half painted when
    // it is fully on its second coat.
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    expect(within(ring).getByText('Blast + Coat 1')).toBeInTheDocument()
    expect(within(ring).getByText('Coat 2')).toBeInTheDocument()
    expect(within(ring).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(ring).getAllByText('100,00%')).toHaveLength(2)
    expect(within(ring).getByText('50,00%')).toBeInTheDocument()
  })

  it('gives every coat its area out of the deck, and the footer the deck m² instead of a bay count', async () => {
    // Feedback Rv1: "thêm thông tin m² ... không cần hiển thị số ô". The
    // denominator travels with the figure so nobody has to hunt for what the
    // percentage is a percentage of.
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    expect(within(ring).getAllByText('1.000,00 / 1.000,00 m²')).toHaveLength(2)
    expect(within(ring).getByText('500,00 / 1.000,00 m²')).toBeInTheDocument()
    // Once in the ring's centre, once in the footer.
    expect(within(ring).getAllByText('1.000,00 m²')).toHaveLength(2)
    expect(within(ring).queryByText(/\d+ ô/)).toBeNull()
  })

  it('sets the centre figure in the largest step that fits the hole (I-2, C1)', async () => {
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    const figure = within(ring).getByTestId('ring-figure')
    const text = figure.textContent ?? ''
    const step = ringFigureStep(text, [type.displaySm, type.cardTitle, type.bodyStrong], DECK_RING)
    expect(figure).toHaveStyle({ fontSize: `${step.fontSize}px` })
    expect(figureFits(text, step, DECK_RING)).toBe(true)
  })

  it('says what the ring itself answers, so it is not read as the cumulative list', async () => {
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    // On the (?) of the ring's centre label, not as a caption under it (CPY-01).
    const tip = within(ring).getByRole('img', { name: 'Vòng tròn: diện tích đang dừng ở mỗi lớp, không cộng dồn' })
    expect(tip.parentElement).toHaveTextContent(/^Tiến độ · Công việc chính$/)
    expect(within(ring).queryByText(/^Vòng tròn:/)).toBeNull()
  })

  it('labels its figures with the work, leaving "Tiến độ sàn" to the all-works figure (I4)', async () => {
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    // Once in the ring's centre, once in the footer.
    expect(within(ring).getAllByText('Tiến độ · Công việc chính')).toHaveLength(2)
    expect(within(ring).queryByText(/Tiến độ sàn/)).toBeNull()
  })

  it('stacks the ring above its rows in its 300-352 px column, the rows its full width (RR-I1)', async () => {
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    const legend = within(ring).getByTestId('stage-legend')
    const stack = legend.parentElement as HTMLElement
    expect(stack).toHaveStyle({ display: 'flex', flexDirection: 'column', alignItems: 'center' })
    expect(within(stack).getByTestId('ring-figure')).toBeInTheDocument()
    expect(legend).toHaveStyle({ alignSelf: 'stretch' })
  })

  it('reads each coat row in two lines: dot, name and percent, then the area (RR-I1)', async () => {
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    const row = within(ring).getByText('Coat 2').closest('[data-testid="stage-legend-row"]') as HTMLElement
    const marker = within(row).getByTestId('stage-legend-marker')
    const line1 = marker.parentElement as HTMLElement
    expect(within(line1).getByText('Coat 2')).toBeInTheDocument()
    // Coat 2 is cumulative: every bay has been through it.
    expect(within(line1).getByText('100,00%')).toBeInTheDocument()
    const area = within(row).getByText('1.000,00 / 1.000,00 m²')
    expect(line1.contains(area)).toBe(false)
    expect(row.children).toHaveLength(2)
  })

  it('keeps the dot on the first line of a wrapped coat name, beside the percent (RR2-M1)', async () => {
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    const row = within(ring).getByText('Coat 2').closest('[data-testid="stage-legend-row"]') as HTMLElement
    const marker = within(row).getByTestId('stage-legend-marker')
    const line1 = marker.parentElement as HTMLElement
    expect(line1).toHaveStyle({ alignItems: 'flex-start' })
    expect(within(line1).getByText('Coat 2')).toHaveStyle({ lineHeight: '17px' })
    expect(within(line1).getByText('100,00%')).toHaveStyle({ lineHeight: '17px' })
    // The 15 px dot centred on the 17 px first line.
    expect(marker).toHaveStyle({ marginTop: '1px' })
  })

  describe('the ring and its coat rows (CHT-02)', () => {
    // Coat 2 and Tháo giáo each hold 500 m² right now; Blast + Coat 1 holds
    // none (every bay is past it), so it has a row and no slice.
    const rowOf = (ring: HTMLElement, name: string) =>
      within(ring).getByText(name).closest('[data-testid="stage-legend-row"]') as HTMLElement
    const sliceOf = (ring: HTMLElement, name: string) =>
      within(within(ring).getByRole('group', { name: 'Diện tích đang dừng ở mỗi lớp' })).getByRole('img', { name })

    it('lights up the slice of a hovered coat row, and highlights the row of a hovered slice', async () => {
      renderPanel()
      const ring = await screen.findByTestId('stage-ring')
      fireEvent.pointerEnter(rowOf(ring, 'Coat 2'))
      expect(sliceOf(ring, 'Coat 2')).toHaveAttribute('opacity', '1')
      expect(sliceOf(ring, 'Tháo giáo')).toHaveAttribute('opacity', '0.35')
      expect(rowOf(ring, 'Coat 2')).toHaveStyle({ background: palette.bgHover })
      fireEvent.pointerLeave(rowOf(ring, 'Coat 2'))
      expect(sliceOf(ring, 'Tháo giáo')).toHaveAttribute('opacity', '1')

      fireEvent.pointerEnter(sliceOf(ring, 'Tháo giáo'))
      expect(rowOf(ring, 'Tháo giáo')).toHaveStyle({ background: palette.bgHover })
      expect(rowOf(ring, 'Coat 2').style.background).toBe('')
      fireEvent.pointerLeave(sliceOf(ring, 'Tháo giáo'))
      expect(rowOf(ring, 'Tháo giáo').style.background).toBe('')
    })

    it('puts the rows in the tab order, and a focused row lights its slice', async () => {
      renderPanel()
      const ring = await screen.findByTestId('stage-ring')
      const rows = within(ring).getAllByTestId('stage-legend-row')
      expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '0', '0'])
      act(() => rowOf(ring, 'Tháo giáo').focus())
      expect(sliceOf(ring, 'Coat 2')).toHaveAttribute('opacity', '0.35')
      act(() => rowOf(ring, 'Tháo giáo').blur())
      expect(sliceOf(ring, 'Coat 2')).toHaveAttribute('opacity', '1')
    })

    it('describes a slice by the area standing at its coat and by its row\'s cumulative figures', async () => {
      // The row is cumulative and the ring is not (Feedback Rv3, item 1), so
      // the slice says both, the row's figures exactly as the row prints them.
      renderPanel()
      const ring = await screen.findByTestId('stage-ring')
      const row = rowOf(ring, 'Coat 2')
      // Name and percent on the first line, the area under them (RR-I1).
      expect(row).toHaveTextContent('Coat 2100,00%1.000,00 / 1.000,00 m²')
      expect(sliceOf(ring, 'Coat 2')).toHaveAccessibleDescription(
        'Đang ở lớp này: 500,00 / 1.000,00 m² · 50,00% Cộng dồn: 1.000,00 / 1.000,00 m² · 100,00%',
      )
      expect(sliceOf(ring, 'Tháo giáo')).toHaveAccessibleDescription(
        'Đang ở lớp này: 500,00 / 1.000,00 m² · 50,00% Cộng dồn: 500,00 / 1.000,00 m² · 50,00%',
      )
    })

    it('re-renders the ring and its rows on hover, not the panel and its canvases (m-4)', async () => {
      renderPanel()
      const ring = await screen.findByTestId('stage-ring')
      await screen.findAllByTestId('canvas')
      const before = canvasRenders.count
      fireEvent.pointerEnter(rowOf(ring, 'Coat 2'))
      fireEvent.pointerEnter(sliceOf(ring, 'Tháo giáo'))
      expect(sliceOf(ring, 'Coat 2')).toHaveAttribute('opacity', '0.35')
      expect(canvasRenders.count).toBe(before)
    })

    it('draws each coat marker as a circle of the coat\'s colour (CLR-03)', async () => {
      renderPanel()
      const ring = await screen.findByTestId('stage-ring')
      const marker = within(rowOf(ring, 'Tháo giáo')).getByTestId('stage-legend-marker')
      expect(marker).toHaveStyle({ borderRadius: '50%', background: '#722ed1', width: '15px', height: '15px' })
      expect(marker.style.boxShadow).toBe('')
    })
  })

  it('explains cộng dồn on the card title\'s (?), not in a subtitle (CPY-01)', async () => {
    renderPanel()
    const title = await screen.findByRole('heading', { name: /Tiến độ theo công đoạn · cộng dồn/ })
    expect(within(title).getByRole('img', { name: 'Ô đã ở lớp sau được tính cho cả các lớp trước.' })).toBeInTheDocument()
    expect(screen.queryByText(/^Ô đã ở lớp sau/)).toBeNull()
  })

  it('drops the section summaries that repeat their columns or name the report sheet (CPY-01)', async () => {
    renderPanel()
    await screen.findByTestId('deck-works-table')
    expect(screen.queryByText(/Trọng số sàn trong công việc ·/)).toBeNull()
    expect(screen.queryByText(/sheet Dashboard/)).toBeNull()
  })

  it('tells the admin when a deck has no drawing, instead of an empty frame', async () => {
    loadDeckWorks.mockResolvedValue({ ...ENTRY, imagePath: null })
    renderPanel()
    expect(await screen.findByText('Chưa có gì để hiển thị')).toBeInTheDocument()
    expect(screen.queryByTestId('lens-A')).not.toBeInTheDocument()
  })

  it('surfaces a load failure rather than rendering nothing', async () => {
    loadDeckWorks.mockRejectedValue(new Error('mạng hỏng'))
    renderPanel()
    expect(await screen.findByText('mạng hỏng')).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — keeping up with the deck', () => {
  it('re-reads the deck when a foreman records a bay, without waiting for a reload', async () => {
    // GAP-01. The admin sits on this panel while a crew works, and every number
    // on it is what someone is being paid against. A figure that silently
    // stopped being true an hour ago is worse than one that is obviously stale.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPanel(false)
      await screen.findByTestId('lens-A')
      await waitFor(() => expect(subscribeDeckStates).toHaveBeenCalledWith('d1', expect.anything()))
      expect(loadDeckWorks).toHaveBeenCalledTimes(1)

      const handlers = subscribeDeckStates.mock.calls[0][1] as {
        onStateChange: (c: unknown) => void
      }
      handlers.onStateChange(ENTRY.deck.cells[0])
      await vi.advanceTimersByTimeAsync(600)

      await waitFor(() => expect(loadDeckWorks).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('collapses a burst of writes into one read', async () => {
    // A foreman ticking a row of bays fires an event each. One re-read per bay
    // is a query storm for a picture that would be identical either way.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPanel(false)
      await screen.findByTestId('lens-A')
      await waitFor(() => expect(subscribeDeckStates).toHaveBeenCalled())
      const handlers = subscribeDeckStates.mock.calls[0][1] as {
        onStateChange: (c: unknown) => void
      }
      for (let i = 0; i < 5; i += 1) handlers.onStateChange(ENTRY.deck.cells[0])
      await vi.advanceTimersByTimeAsync(600)

      await waitFor(() => expect(loadDeckWorks).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the subscription when the deck changes, so two decks cannot cross', async () => {
    const stop = vi.fn()
    subscribeDeckStates.mockReturnValue(stop)
    const { unmount } = renderPanel(false)
    await screen.findByTestId('lens-A')
    unmount()
    expect(stop).toHaveBeenCalled()
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

  it('falls back to the coat\'s own colour for a reached bay outside every zone', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Coat 2')
    // ZONE is planned on Tháo giáo, so Coat 2 has no zones: both bays have
    // reached it and neither is in a zone for it. A zone-only rule would leave
    // them blank, which is most decks before the plan is drawn.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#bfbfbf'))
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#bfbfbf')
  })

  it('leaves a bay that has not reached the coat white, with no hatch', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    // c1 is AT Tháo giáo and in its zone; c2 is at Coat 2 and has not got
    // there. Feedback Rv1: an unreached bay shows the bare drawing -- it used
    // to wear the coat's colour under a hatch, which read as "done, sort of".
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#eb2f96'))
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-hatched', 'false')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-hatched', 'false')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-outline', '')
  })

  it('shows a planned bay that has not reached the coat as a faint, framed zone bay', async () => {
    // Feedback Rv2 item 5: Linh drew four zones on Topcoat and saw a white deck,
    // because nothing had reached Topcoat yet. c2 is at Coat 2 and planned for
    // Tháo giáo: it wears the zone colour faintly, with a dashed frame, and is
    // NOT counted as reached.
    listDeckZones.mockResolvedValue([{ ...ZONE, cellIds: ['c1', 'c2'] }])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-outline', '#eb2f96'))
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#eb2f96')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-opacity', '0.18')
    // c1 has reached it: solid, unframed.
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-outline', '')
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-opacity', '')
    // Half the deck reached, in the lens header and again on the zone's own row.
    expect(within(screen.getByTestId('lens-A')).getAllByText('500,00 / 1.000,00 m²')).toHaveLength(2)
  })

  it('draws a zone in the colour the admin chose for it', async () => {
    listDeckZones.mockResolvedValue([{ ...ZONE, color: '#13c2c2' }])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#13c2c2'))
  })

  it('never hands an unset zone one of the coat colours', async () => {
    // The palette's first entry is a stage colour on this deck, so the zone
    // takes the next one. This is item 6 for zones created before 0027.
    listDeckZones.mockResolvedValue([ZONE])
    loadDeckWorks.mockResolvedValue({
      ...ENTRY,
      works: [{
        ...ENTRY.works[0],
        stages: STAGES.map((st, i) => (i === 0 ? { ...st, color: '#eb2f96' } : st)),
      }],
    })
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#13c2c2'))
  })

  it('hatches nothing at a coat both bays are already past', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    // Cumulative: a bay at Tháo giáo has been through Blast + Coat 1.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-hatched', 'false'))
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-hatched', 'false')
  })

  it('says what white means, rather than leaving it to be inferred', async () => {
    renderPanel()
    // The map legend is the lens title's (?), not a line read every visit (CPY-01).
    const lens = await screen.findByTestId('lens-A')
    const title = within(lens).getByRole('heading', { level: 3 })
    expect(within(title).getByRole('img', { name: /ô chưa đạt, chưa kế hoạch để trắng/ })).toBeInTheDocument()
    expect(screen.queryByText(/ô chưa đạt, chưa kế hoạch để trắng/)).toBeNull()
  })

  it('names no gesture under the toolbar: the Gộp thành zone tooltip already does (CPY-01)', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    expect(screen.queryByText(/Giữ Shift rồi kéo trên bản vẽ để quét chọn/)).toBeNull()
  })

  it('counts each zone against the coat being viewed', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')

    const lens = await screen.findByTestId('lens-A')
    expect(within(lens).getByText('Khu A — Tháo giáo')).toBeInTheDocument()
    // One 500 m² bay in the zone, and it has reached the coat. In m², not
    // bays: Feedback Rv1 struck every bay count from this panel.
    expect(within(lens).getByText('500,00 / 500,00 m²')).toBeInTheDocument()
    expect(within(lens).getByText('Tiến độ từng zone · Tháo giáo')).toBeInTheDocument()
    // Of the deck's 1.000 m², the 500 at Tháo giáo have reached this coat.
    expect(within(lens).getByText('500,00 / 1.000,00 m²')).toBeInTheDocument()
  })

  it('hides the zones of every other coat', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    // ZONE is planned against s3; the lens opens on s1.
    expect(await screen.findByText(/chưa có zone nào được lên kế hoạch/)).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — zones', () => {
  it('shows the way to make a zone before any bay is picked, but will not run it', async () => {
    // Hiding the button until bays are selected takes away the only thing on
    // the panel that says zones can be made here at all -- the admin would have
    // to already know the gesture to discover the control for it.
    renderPanel()
    await screen.findByTestId('lens-A')
    const group = screen.getByRole('button', { name: /Gộp thành zone/ })
    expect(group).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Bỏ chọn' })).not.toBeInTheDocument()
    // Why it is disabled, without a pointer (Q2): its description, and a
    // named stop in the tab order that opens the tip.
    expect(group).toHaveAccessibleDescription('Chọn ô trên bản vẽ trước — bấm từng ô, hoặc giữ Shift rồi kéo')
    const stop = screen.getByRole('group', { name: 'Gộp thành zone (0)' })
    expect(stop).toHaveAttribute('tabindex', '0')
    expect(stop).toContainElement(group)
    act(() => stop.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Chọn ô trên bản vẽ trước')
  })

  it('creates one zone per coat that was given dates, from one dialog', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByTestId('band-all'))
    await userEvent.click(await screen.findByRole('button', { name: /Gộp thành zone/ }))

    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.type(startInputOf('Coat 2'), '01/09/2026')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(createZone).toHaveBeenCalledTimes(1))
    expect(createZone.mock.calls[0][1]).toMatchObject({
      name: 'Khu A — Coat 2', stageId: 's2', startDate: '2026-09-01',
    })
    expect(createZone.mock.calls[0][2]).toEqual(['c1', 'c2'])
  })

  it('creates the zone in the first palette colour no coat wears, unless another is picked', async () => {
    // Feedback Rv2 item 6. The picker offers only colours outside this
    // (work, deck)'s stage palette, so a conflict cannot be built here; the
    // API still refuses one. The stages travel with the call for that check.
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByTestId('band-all'))
    await userEvent.click(await screen.findByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.type(startInputOf('Coat 2'), '01/09/2026')
    await userEvent.keyboard('{Enter}')

    // Every swatch offered is outside the stage palette.
    const swatches = within(screen.getByTestId('zone-color')).getAllByRole('radio')
    for (const sw of swatches) {
      expect(STAGES.map((st) => st.color)).not.toContain(sw.getAttribute('data-color'))
    }
    await userEvent.click(within(screen.getByTestId('zone-color')).getByRole('radio', { name: 'Màu #fa8c16' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(createZone).toHaveBeenCalledTimes(1))
    expect(createZone.mock.calls[0][1]).toMatchObject({ color: '#fa8c16' })
    expect(createZone.mock.calls[0][3]).toEqual(STAGES)
  })

  it('defaults the colour to the first free palette entry', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByTestId('band-all'))
    await userEvent.click(await screen.findByRole('button', { name: /Gộp thành zone/ }))
    await userEvent.type(screen.getByLabelText('Tên zone'), 'Khu A')
    await userEvent.type(startInputOf('Coat 2'), '01/09/2026')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(createZone).toHaveBeenCalledTimes(1))
    expect(createZone.mock.calls[0][1]).toMatchObject({ color: '#eb2f96' })
  })

  it('recolours an existing zone from its dates dialog', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Màu #13c2c2' }))

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { color: '#13c2c2' }, STAGES))
    // Re-read, so the row swatch and the bays follow the new colour.
    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
  })

  it('draws the zone colours as plain circles, the picked one ringed apart from its colour (CLR-01, CLR-02)', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    // The zone's row marker is a circle too (CLR-03, R3-D).
    const marker = await screen.findByTestId('zone-marker')
    expect(marker).toHaveStyle({ borderRadius: '50%' })
    expect(marker.style.boxShadow).toBe('')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    const swatches = within(await screen.findByTestId('zone-color')).getAllByRole('radio')
    const picked = swatches.filter((sw) => sw.getAttribute('aria-checked') === 'true')
    expect(picked).toHaveLength(1)
    for (const sw of swatches) {
      expect(sw).toHaveClass('pp-swatch')
      expect(sw).toHaveStyle({ borderRadius: '50%' })
      expect(sw.style.borderStyle === 'none' || sw.style.border === '0px').toBe(true)
      expect(sw.style.boxShadow).toBe(sw === picked[0]
        ? `0 0 0 2px ${palette.bgContainer}, 0 0 0 4px ${palette.text}`
        : '')
    }
    // The selected ring and the focus ring reach 4 px past a circle: a 10 px
    // gap keeps either off the next circle (R2).
    expect(within(screen.getByTestId('zone-color')).getByRole('radiogroup', { name: 'Màu zone' })).toHaveStyle({ gap: '10px' })
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
    await userEvent.type(startInputOf('Coat 2'), '01/09/2026')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo zone' }))

    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Gộp thành zone/ })).toBeDisabled())
  })

  it('edits a zone date in place, without remaking the zone', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')

    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    // One RangePicker holds both ends (owner request): the finish is retyped,
    // the start rides along unchanged in the same patch.
    const dialog = await screen.findByRole('dialog')
    const finish = within(dialog).getByPlaceholderText('Kết thúc')
    await userEvent.clear(finish)
    await userEvent.type(finish, '20/09/2026')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { startDate: '2026-09-01', finishDate: '2026-09-20' }))
    expect(createZone).not.toHaveBeenCalled()
    expect(deleteZone).not.toHaveBeenCalled()
  })

  it('shows the saved dates back in the dialog, not the ones it opened with', async () => {
    // Feedback Rv4: "Hiện tại bị lỗi không sửa được". The write landed every
    // time; the dialog held a copy of the zone taken when it opened, so the
    // picker went on showing the old dates and the admin read that as a
    // refusal.
    listDeckZones.mockResolvedValueOnce([ZONE])
      .mockResolvedValue([{ ...ZONE, finishDate: '2026-09-20' }])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))

    const dialog = await screen.findByRole('dialog')
    const finish = within(dialog).getByPlaceholderText('Kết thúc')
    await userEvent.clear(finish)
    await userEvent.type(finish, '20/09/2026')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(
      within(screen.getByRole('dialog')).getByPlaceholderText('Kết thúc'),
    ).toHaveValue('20/09/2026'))
  })

  it('adds the bays selected on the drawing to an existing zone', async () => {
    // Feedback Rv4: "Cho phép thêm/bớt ô trong Zone đã gộp". The selection on
    // the drawing is the input, so growing a zone is the same gesture as
    // building one.
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByTestId('cell-R1C2'))
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Thêm 1 ô đã chọn' }))

    // ZONE already holds c1; c2 is the bay just picked.
    await waitFor(() => expect(setZoneCells).toHaveBeenCalledWith('z1', ['c1', 'c2']))
  })

  it('drops the bays selected on the drawing from an existing zone', async () => {
    listDeckZones.mockResolvedValue([{ ...ZONE, cellIds: ['c1', 'c2'] }])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByTestId('cell-R1C2'))
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Bỏ 1 ô đã chọn' }))

    await waitFor(() => expect(setZoneCells).toHaveBeenCalledWith('z1', ['c1']))
  })

  it('offers nothing to add or drop until bays are picked', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))

    const add = await screen.findByRole('button', { name: 'Thêm 0 ô đã chọn' })
    expect(add).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bỏ 0 ô đã chọn' })).toBeDisabled()
    // The reason is on the disabled buttons, like Gộp thành zone (CPY-01):
    // their description, never a sentence on screen.
    const hint = 'Chọn ô trên bản vẽ rồi quay lại đây để thêm hoặc bỏ.'
    expect(add).toHaveAccessibleDescription(hint)
    expect(screen.getByRole('button', { name: 'Bỏ 0 ô đã chọn' })).toHaveAccessibleDescription(hint)
    expect(screen.queryByRole('tooltip')).toBeNull()
    for (const el of screen.getAllByText(hint)) {
      expect(el).toHaveStyle({
        position: 'absolute', width: '1px', height: '1px', padding: '0px', margin: '-1px',
        overflow: 'hidden', whiteSpace: 'nowrap',
      })
      expect(el.style.clip).toMatch(/rect\(0/)
      expect(el.style.borderStyle === 'none' || el.style.border === '0px').toBe(true)
    }
    // A disabled button takes no focus, so the tip opens from its wrapper,
    // which the keyboard reaches while the button is disabled (CPY-02) and
    // which says what it holds (Q8).
    const wrapper = add.parentElement as HTMLElement
    expect(wrapper).toHaveAttribute('tabindex', '0')
    expect(wrapper).toBe(screen.getByRole('group', { name: 'Thêm 0 ô đã chọn' }))
    act(() => wrapper.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(hint)
    act(() => wrapper.blur())
    await userEvent.hover(wrapper)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(hint)
    // And the intro keeps its data, not the obvious second sentence.
    const dialog = screen.getByRole('dialog')
    // The zone's coat and bay count, as KeyFacts under the title (HLT-01).
    expect(keyFactTexts(dialog)).toEqual(['Tháo giáo', '1 ô'])
  })

  it('writes the zone\'s stage across its bays on Ghi thực tế, and re-reads the deck', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ghi thực tế' }))

    await waitFor(() => expect(setZoneActual).toHaveBeenCalledWith('z1', 's3'))
    await waitFor(() => expect(loadDeckWorks).toHaveBeenCalledTimes(2))
  })

  it('names what a zone deletion does and does not destroy, before doing it', async () => {
    listDeckZones.mockResolvedValue([ZONE])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Xoá zone' }))

    expect(await screen.findByText('Xoá zone Khu A — Tháo giáo?')).toBeInTheDocument()
    // Each consequence its own item (RUL-01).
    expect(consequenceItems()).toEqual(['Tiến độ đã ghi trên các ô giữ nguyên'])
    expect(screen.getByText('Kế hoạch của zone này bị xoá:')).toBeInTheDocument()
    // The consequence reads as a sentence, not a reference into the spec (CPY-04).
    expectNoSpecIds()
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
    works: [{
      ...ENTRY.works[0],
      cells: [{ ...CELLS[0], note: 'Bề mặt còn ẩm, hoãn sơn sang mai' }, CELLS[1]],
    }],
  }

  it('flags the bay that carries a note, and only that one', async () => {
    loadDeckWorks.mockResolvedValue(NOTED)
    renderPanel(false)
    await waitFor(() => expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-marked', 'true'))
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-marked', 'false')
  })

  it('shows every note the bay has carried, newest first', async () => {
    // A bay is ticked once per coat and can carry a remark each time, so "the
    // note" was never one thing: cells.note is whichever was written last, and
    // the admin had no way to know it was the third of three.
    loadDeckWorks.mockResolvedValue(NOTED)
    listCellNotes.mockResolvedValue([
      {
        id: 3, at: '2026-08-29T11:47:00Z', stageName: 'Tháo giáo',
        note: 'Bề mặt còn ẩm, hoãn sơn sang mai',
        byName: 'Lê Trung Hiếu', byUsername: 'gs.hieu',
      },
      {
        id: 1, at: '2026-08-27T08:00:00Z', stageName: 'Blast + Coat 1',
        note: 'Có vết rỗ ở góc', byName: 'Lê Trung Hiếu', byUsername: 'gs.hieu',
      },
    ])
    renderPanel(false)
    await userEvent.click(await screen.findByTestId('cell-R1C1'))

    await waitFor(() => expect(listCellNotes).toHaveBeenCalledWith('c1'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Bề mặt còn ẩm, hoãn sơn sang mai'))
      .toBeInTheDocument()
    expect(within(dialog).getByText('Có vết rỗ ở góc')).toBeInTheDocument()
    // Each against the coat it belongs to: the same sentence means different
    // things at Blast + Coat 1 and at Tháo giáo.
    expect(within(dialog).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(dialog).getByText('Blast + Coat 1')).toBeInTheDocument()
    expect(within(dialog).getByText(/29\.08\.2026/)).toBeInTheDocument()
    // And which of them the drawing's flag is showing.
    expect(within(dialog).getByText('Đang hiện trên bản vẽ')).toBeInTheDocument()
  })

  it('still shows the latest note when the history cannot be read', async () => {
    // The sentence the admin tapped the bay for is already in hand, on
    // cells.note. Losing the history must not lose it.
    loadDeckWorks.mockResolvedValue(NOTED)
    listCellNotes.mockRejectedValue(new Error('mất kết nối'))
    renderPanel(false)
    await userEvent.click(await screen.findByTestId('cell-R1C1'))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Không tải được lịch sử ghi chú')).toBeInTheDocument()
    expect(within(dialog).getByText('Bề mặt còn ẩm, hoãn sơn sang mai')).toBeInTheDocument()
  })

  it('opens nothing for a bay with no note', async () => {
    loadDeckWorks.mockResolvedValue(NOTED)
    renderPanel(false)
    await userEvent.click(await screen.findByTestId('cell-R1C2'))
    expect(screen.queryByText(/Ghi chú · ô/)).not.toBeInTheDocument()
  })

  it('still selects bays while editing, rather than opening the note', async () => {
    loadDeckWorks.mockResolvedValue(NOTED)
    renderPanel(true)
    await userEvent.click(await screen.findByTestId('cell-R1C1'))
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-selected', 'true')
    expect(screen.queryByText('Bề mặt còn ẩm, hoãn sơn sang mai')).not.toBeInTheDocument()
  })
})

describe('DeckProgressPanel — the report copy of a note (0023)', () => {
  const NOTED = {
    ...ENTRY,
    works: [{
      ...ENTRY.works[0],
      cells: [{ ...CELLS[0], note: 'Bề mặt còn ẩm, hoãn sơn sang mai' }, CELLS[1]],
    }],
  }
  const NOTE_ROW = {
    id: 3, at: '2026-08-29T11:47:00Z', stageName: 'Tháo giáo',
    note: 'Bề mặt còn ẩm, hoãn sơn sang mai',
    byName: 'Lê Trung Hiếu', byUsername: 'gs.hieu', byId: 'u1',
    reportNote: null, reportHidden: false, reportEditedByName: null, reportEditedAt: null,
  }

  beforeEach(() => {
    loadDeckWorks.mockResolvedValue(NOTED)
    listCellNotes.mockResolvedValue([NOTE_ROW])
  })

  /** Sửa mode: a bay click selects, so the notes are reached through the list. */
  const openNoteWhileEditing = async () => {
    renderPanel(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Ghi chú (1)' }))
    await userEvent.click(await screen.findByRole('button', { name: /^R1C1/ }))
    // By title, then up to the dialog: the list's own dialog is still
    // unmounting while this one opens, so "the dialog" is briefly two.
    const title = await screen.findByText('Ghi chú · ô R1C1')
    const dialog = title.closest('[role="dialog"]') as HTMLElement
    await within(dialog).findByText('Bề mặt còn ẩm, hoãn sơn sang mai')
    return dialog
  }

  it('offers no report actions on a note while only looking', async () => {
    // Xem carries no write, by the owner's rule for this screen. The thread is
    // read here exactly as the tablet reads it.
    renderPanel(false)
    await userEvent.click(await screen.findByTestId('cell-R1C1'))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Bề mặt còn ẩm, hoãn sơn sang mai')
    expect(within(dialog).queryByRole('button', { name: /báo cáo/ })).toBeNull()
  })

  it('reaches a bay\'s notes in Sửa mode through the notes list, since a click there selects', async () => {
    const dialog = await openNoteWhileEditing()
    expect(within(dialog).getByRole('button', { name: 'Sửa cho báo cáo' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Ẩn khỏi báo cáo' })).toBeInTheDocument()
  })

  it('writes a report version through the rpc and re-reads the thread', async () => {
    const dialog = await openNoteWhileEditing()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sửa cho báo cáo' }))

    const box = await screen.findByLabelText('Bản cho báo cáo')
    // What the field is for is its label's (?); the restore button says the
    // rest (CPY-01).
    const tip = screen.getByRole('img', { name: 'Chỉ file Excel in bản này. GS và màn hình này vẫn thấy ghi chú gốc.' })
    expect(screen.queryByText(/^Chỉ file Excel in bản này/)).toBeNull()
    // Beside the label, not in it: inside, a click on the (?) focused the
    // field and the tip joined the field's name (CPY-02).
    expect(tip.closest('label')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Bản cho báo cáo' })).toBe(box)
    // Prefilled with what will otherwise print, so the admin edits rather
    // than retypes.
    expect(box).toHaveValue('Bề mặt còn ẩm, hoãn sơn sang mai')
    await userEvent.clear(box)
    await userEvent.type(box, 'Bề mặt ẩm, đã sơn lại ngày sau')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản cho báo cáo' }))

    await waitFor(() =>
      expect(setReportNote).toHaveBeenCalledWith(3, 'Bề mặt ẩm, đã sơn lại ngày sau', false))
    expect(await screen.findByText('Đã lưu bản cho báo cáo')).toBeInTheDocument()
    // The thread is what the admin is looking at; it must show the stamp.
    await waitFor(() => expect(listCellNotes).toHaveBeenCalledTimes(2))
  })

  it('treats an emptied box as "print the original again"', async () => {
    const dialog = await openNoteWhileEditing()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sửa cho báo cáo' }))
    await userEvent.clear(await screen.findByLabelText('Bản cho báo cáo'))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản cho báo cáo' }))

    await waitFor(() => expect(setReportNote).toHaveBeenCalledWith(3, null, false))
    expect(await screen.findByText('Đã khôi phục bản gốc')).toBeInTheDocument()
  })

  it('hides a note from the report with one press, keeping any report version', async () => {
    listCellNotes.mockResolvedValue([{ ...NOTE_ROW, reportNote: 'Bản báo cáo' }])
    const dialog = await openNoteWhileEditing()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ẩn khỏi báo cáo' }))

    await waitFor(() => expect(setReportNote).toHaveBeenCalledWith(3, 'Bản báo cáo', true))
    expect(await screen.findByText('Đã ẩn khỏi báo cáo')).toBeInTheDocument()
  })

  it('forgets a half-typed report version when the box is closed without saving', async () => {
    // The app-wide rule: a dialog closed by any path comes back clean.
    const dialog = await openNoteWhileEditing()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sửa cho báo cáo' }))
    await userEvent.type(await screen.findByLabelText('Bản cho báo cáo'), ' thêm')
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    // No assertion on the closed dialog itself: jsdom never finishes antd's
    // leave motion, so a closed modal lingers in the tree with its last
    // content frozen. What is observable, and what matters, is what the box
    // holds when it is opened again.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sửa cho báo cáo' }))
    expect(await screen.findByLabelText('Bản cho báo cáo'))
      .toHaveValue('Bề mặt còn ẩm, hoãn sơn sang mai')
    expect(setReportNote).not.toHaveBeenCalled()
  })

  it('reports a refused write and leaves the thread as it was', async () => {
    setReportNote.mockRejectedValue(new Error('set_report_note: admin only'))
    const dialog = await openNoteWhileEditing()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ẩn khỏi báo cáo' }))

    expect(await screen.findByText(/admin only/)).toBeInTheDocument()
    expect(listCellNotes).toHaveBeenCalledTimes(1)
  })
})

const GG = {
  id: 'w2', projectId: 'p1', seq: 2, name: 'Tháo giáo', kind: 'bays' as const,
  weight: 0.4, counts: true, manualProgress: 0,
}
const GG_STAGES = [{ id: 't1', seq: 1, name: 'Tháo giáo lửng', color: '#333333', weight: 1 }]
/** The same deck in two works: Sơn (W .6, D 1, at 70%) and Tháo giáo (W .4, D 1, untouched). */
const TWO_WORKS = {
  ...ENTRY,
  works: [
    { work: { ...WORK, name: 'Sơn', weight: 0.6 }, weight: 1, stages: STAGES, cells: CELLS, audit: {} },
    { work: GG, weight: 1, stages: GG_STAGES, cells: CELLS.map((c) => ({ ...c, stageId: null })), audit: {} },
  ],
}

describe('DeckProgressPanel — công việc', () => {
  beforeEach(() => {
    loadDeckWorks.mockResolvedValue(TWO_WORKS)
  })

  it('offers the works the deck is part of, opening on the first', async () => {
    renderPanel(false)
    await screen.findByTestId('lens-A')
    expect(screen.getByLabelText('Công việc')).toBeInTheDocument()
    // Named by its card, apart from the deck page's other work selects (M7).
    expect(screen.getByRole('combobox', { name: 'Công việc · Tiến độ theo lớp sơn' })).toBeInTheDocument()
    expect(within(screen.getByTestId('lens-A')).getByText('Tiến độ · Blast + Coat 1')).toBeInTheDocument()
  })

  it('switching the work switches the coats on offer, and the lens with them', async () => {
    renderPanel(false)
    await screen.findByTestId('lens-A')
    await pickLens('Công việc', 'Tháo giáo')
    expect(await within(screen.getByTestId('lens-A')).findByText('Tiến độ · Tháo giáo lửng')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Lớp sơn đang xem'))
    expect(screen.queryByTitle('Coat 2')).toBeNull()
  })

  it('reports the deck\'s tổng hợp upward, not one work\'s figure', async () => {
    // (0.6·1)·0.7 + (0.4·1)·0 over 0.6 + 0.4 = 0.42. The header shows the
    // deck across its works, not the coat list that happens to be open.
    const onProgress = vi.fn()
    render(<AntApp><DeckProgressPanel deckId="d1" editable={false} onProgress={onProgress} /></AntApp>)
    await screen.findByTestId('lens-A')
    await waitFor(() => {
      const last = onProgress.mock.calls.at(-1)?.[0] as number
      expect(last).toBeCloseTo(0.42, 12)
    })
  })

  it('lists each work\'s weight and progress for this deck, then the tổng hợp', async () => {
    renderPanel(false)
    const table = await screen.findByTestId('deck-works-table')
    expect(within(table).getByText('70,00%')).toBeInTheDocument()
    expect(within(table).getAllByText('1,00')).toHaveLength(2)
    expect(within(table).getByText('Tổng hợp')).toBeInTheDocument()
    expect(within(table).getByText('42,00%')).toBeInTheDocument()
    // QA: the weight sat unlabelled mid-row; the columns now say what they hold.
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Công việc', 'Trọng số sàn', 'Tiến độ'])
  })

  it('sets the works table on the type scale: names and figures body, the tổng hợp bodyStrong (TYP-02)', async () => {
    renderPanel(false)
    const table = await screen.findByTestId('deck-works-table')
    for (const h of within(table).getAllByRole('columnheader')) {
      expect(h).toHaveStyle({ fontSize: '13px', fontWeight: '600' })
    }
    const firstRow = within(table).getAllByRole('row')[1]
    expect(weightOf(within(firstRow).getAllByRole('cell')[0])).toBe(400)
    expect(weightOf(within(table).getByText('70,00%'))).toBe(400)
    expect(weightOf(within(table).getByText('Tổng hợp'))).toBe(600)
    expect(weightOf(within(table).getByText('42,00%'))).toBe(600)
  })

  it('gives the header toolbar and the notes button the default height: they sit outside a table (CTL-01)', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    const segmented = screen.getByText('So sánh hai lớp').closest('.ant-segmented')
    expect(segmented).not.toHaveClass('ant-segmented-sm')
    expect(screen.getByRole('button', { name: /^Ghi chú \(/ })).not.toHaveClass('ant-btn-sm')
    // The zoom group is one compound control, as the password field with its
    // generator is: small buttons in a 4px-padded, 1px-bordered frame come to
    // controlHeightSM + 10, within 1px of the default Segmented (Q3).
    const zoomOut = screen.getByRole('button', { name: 'Thu nhỏ' })
    const frame = zoomOut.closest('.ant-space') as HTMLElement
    expect(frame).toHaveStyle({ padding: '4px', borderWidth: '1px', borderStyle: 'solid' })
    for (const name of ['Thu nhỏ', 'Phóng to', 'Vừa khung']) {
      const b = screen.getByRole('button', { name })
      expect(b).toHaveClass('ant-btn-sm')
      expect(frame).toContainElement(b)
    }
    const t = theme.getDesignToken(adminTheme)
    expect(Math.abs(t.controlHeightSM + 2 * 4 + 2 * 1 - t.controlHeight)).toBeLessThanOrEqual(1)
  })

  it('sets every hand-set text in the panel on the type scale (TYP-01)', async () => {
    const { container } = renderPanel(false)
    await screen.findByTestId('deck-works-table')
    await screen.findAllByTestId('stage-legend-row')
    expectOnScale(container)
  })

  it('shows one work without a selector, and says which it is', async () => {
    loadDeckWorks.mockResolvedValue(ENTRY)
    renderPanel(false)
    await screen.findByTestId('lens-A')
    expect(screen.queryByLabelText('Công việc')).toBeNull()
    expect(screen.getByText('Công việc: Công việc chính')).toBeInTheDocument()
  })

  it('tells the admin when the deck is in no work yet', async () => {
    loadDeckWorks.mockResolvedValue({ ...ENTRY, works: [] })
    renderPanel(false)
    expect(await screen.findByText('Sàn này chưa thuộc công việc nào')).toBeInTheDocument()
    expect(screen.getByText('Gán sàn vào một công việc ở mục Công việc, rồi cấu hình lớp sơn cho nó.')).toBeInTheDocument()
  })
})

/**
 * RV6-13 -- "Tất cả công đoạn" as a layer of its own.
 *
 * The admin asked for the GS live view inside the panel: one picture of the
 * deck coloured by the furthest coat each bay has reached, without having to
 * step through the coats one select at a time.
 */
describe('DeckProgressPanel — the all-stages layer (RV6-13)', () => {
  /** One zone per coat, handed back in seq order inside each coat. */
  const ZONE_B = {
    id: 'z2', name: 'Khu B — Coat 2', stageId: 's2', color: '#13c2c2',
    startDate: null, finishDate: null, cellIds: ['c2'],
  }

  beforeEach(() => {
    listDeckZones.mockResolvedValue([{ ...ZONE, cellIds: ['c1', 'c2'] }, ZONE_B])
  })

  /**
   * What one layer select offers, in order.
   *
   * Scoped to that select's own dropdown -- both are mounted at once in the
   * split view, and antd leaves a closed one in the document, so an unscoped
   * query reads whichever was opened first.
   */
  const optionLabels = (id: string) => {
    const dropdown = (document.getElementById(`${id}_list`) as HTMLElement)
      .closest('.ant-select-dropdown') as HTMLElement
    return Array.from(dropdown.querySelectorAll('.ant-select-item-option'))
      .map((el) => el.getAttribute('title'))
  }

  it('offers Tất cả công đoạn as the first option on both layer selects', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByText('So sánh hai lớp'))
    await screen.findByTestId('lens-B')

    const coats = ['Blast + Coat 1', 'Coat 2', 'Tháo giáo']
    await userEvent.click(within(screen.getByTestId('lens-A')).getByLabelText('Công đoạn'))
    expect(optionLabels('lens-a-stage')).toEqual(['Tất cả công đoạn', ...coats])
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(screen.getByTestId('lens-B')).getByLabelText('Công đoạn'))
    expect(optionLabels('lens-b-stage')).toEqual(['Tất cả công đoạn', ...coats])
  })

  it('labels each pane\'s select by what it picks, not by the side the subtitle already names (QA F6)', async () => {
    // "Lớp bên trái" sat directly under a subtitle reading "Lớp bên trái",
    // and the select picks a coat, not a layer.
    renderPanel()
    await screen.findByTestId('lens-A')
    expect(screen.getByLabelText('Lớp sơn đang xem')).toHaveAttribute('id', 'lens-a-stage')

    await userEvent.click(screen.getByText('So sánh hai lớp'))
    const lensA = await screen.findByTestId('lens-A')
    const lensB = await screen.findByTestId('lens-B')
    expect(within(lensA).getByLabelText('Công đoạn')).toHaveAttribute('id', 'lens-a-stage')
    expect(within(lensB).getByLabelText('Công đoạn')).toHaveAttribute('id', 'lens-b-stage')
    expect(screen.queryByLabelText('Lớp bên trái')).toBeNull()
    expect(screen.queryByLabelText('Lớp bên phải')).toBeNull()
    // Nor does a subtitle name the sides any more: the position is obvious (CPY-01).
    expect(within(lensA).queryByText('Lớp bên trái')).toBeNull()
    expect(within(lensB).queryByText(/Lớp bên phải/)).toBeNull()
  })

  it('colours every bay by the furthest coat it has reached, with no plan overlay', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tất cả công đoạn')

    // paintLensColors: c1 is at Tháo giáo, c2 at Coat 2. Zones belong to one
    // coat, so none of them is drawn here however the plan toggle sits.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#722ed1'))
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#bfbfbf')
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-outline', '')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-outline', '')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-opacity', '')
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-labels', '')
  })

  it('gives the layer one chip per coat, with the share of the deck that reached it', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tất cả công đoạn')

    const chips = await screen.findByTestId('lens-chips-A')
    // Cumulative, like every other reading here: both bays are past Coat 2,
    // only the 500 m² one has reached Tháo giáo.
    expect(within(chips).getAllByTestId('lens-chip')).toHaveLength(3)
    expect(within(chips).getByText('Blast + Coat 1')).toBeInTheDocument()
    expect(within(chips).getAllByText('100,00%')).toHaveLength(2)
    expect(within(chips).getByText('50,00%')).toBeInTheDocument()
    // Each chip's colour is a circle, no inset frame (CLR-03, R3-D).
    for (const m of within(chips).getAllByTestId('lens-chip-marker')) {
      expect(m).toHaveStyle({ borderRadius: '50%' })
      expect(m.style.boxShadow).toBe('')
    }
  })

  it('lists the zones of every coat, in coat order then zone order', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tất cả công đoạn')

    const lens = await screen.findByTestId('lens-A')
    expect(within(lens).getByText('Tiến độ từng zone · Tất cả công đoạn')).toBeInTheDocument()
    const rows = within(lens).getAllByRole('button', { name: /^Mốc ngày của/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Mốc ngày của Khu B — Coat 2',
      'Mốc ngày của Khu A — Tháo giáo',
    ])
  })

  it('refuses to build a zone while the layer shows every coat', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByTestId('band-all'))
    await pickLens('Lớp sơn đang xem', 'Tất cả công đoạn')

    // A zone row is one stage_id; there is no coat to write here.
    const make = await screen.findByRole('button', { name: /Gộp thành zone/ })
    expect(make).toBeDisabled()
    expect(make).toHaveAccessibleDescription('Chọn một công đoạn để tạo zone')
    await userEvent.hover(make.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Chọn một công đoạn để tạo zone')
  })
})

/**
 * RV6-12 -- the plan overlay, on a switch.
 *
 * Linh reads the drawing for what is DONE; the faint zone tints and dashed
 * frames that answer "what is planned" are noise while she is doing that.
 */
describe('DeckProgressPanel — hiding the plan (RV6-12)', () => {
  beforeEach(() => {
    listDeckZones.mockResolvedValue([{ ...ZONE, cellIds: ['c1', 'c2'] }])
  })

  it('shows the plan by default, as the panel always has', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    expect(screen.getByRole('switch', { name: 'Hiện kế hoạch' })).toBeChecked()
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-outline', '#eb2f96'))
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-labels', 'Khu A — Tháo giáo')
  })

  it('drops the tints, frames and labels when the plan is switched off', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(screen.getByRole('switch', { name: 'Hiện kế hoạch' }))

    // c1 reached Tháo giáo: the COAT's colour now, not its zone's magenta.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#722ed1'))
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-opacity', '')
    // c2 is planned but has not reached it: nothing at all.
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-outline', '')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-opacity', '')
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-labels', '')
    // The table under the drawing is data, not overlay: it stays.
    expect(within(screen.getByTestId('lens-A')).getByText('Khu A — Tháo giáo')).toBeInTheDocument()
  })
})


/**
 * RV6-11 -- renaming a zone (docx item 4).
 *
 * The name is stored with its coat suffix, so the box holds the base and the
 * suffix is re-applied on save: an admin retyping "Khu A — Tháo giáo" by hand
 * would eventually produce "Khu A — Tháo giáo — Tháo giáo".
 */
describe('DeckProgressPanel — renaming a zone (RV6-11)', () => {
  beforeEach(() => {
    listDeckZones.mockResolvedValue([ZONE])
  })

  const openDates = async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Tháo giáo')
    await userEvent.click(await screen.findByRole('button', { name: 'Mốc ngày của Khu A — Tháo giáo' }))
    return within(await screen.findByRole('dialog')).getByLabelText('Tên zone')
  }

  it('prefills the box with the base name, without the coat suffix', async () => {
    expect(await openDates()).toHaveValue('Khu A')
  })

  it('writes the new name with the coat suffix, then re-reads the plan', async () => {
    const input = await openDates()
    await userEvent.clear(input)
    await userEvent.type(input, 'Khu B')
    await userEvent.tab()

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { name: 'Khu B — Tháo giáo' }))
    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))
  })

  it('commits on Enter too, so the name can be saved without leaving the field', async () => {
    const input = await openDates()
    await userEvent.clear(input)
    await userEvent.type(input, 'Khu C{Enter}')

    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { name: 'Khu C — Tháo giáo' }))
  })

  it('writes nothing when the name comes back unchanged', async () => {
    const input = await openDates()
    await userEvent.clear(input)
    await userEvent.type(input, 'Khu A')
    await userEvent.tab()

    expect(updateZone).not.toHaveBeenCalled()
  })

  it('reverts an emptied box instead of storing a nameless zone', async () => {
    const input = await openDates()
    await userEvent.clear(input)
    await userEvent.tab()

    expect(updateZone).not.toHaveBeenCalled()
    await waitFor(() => expect(input).toHaveValue('Khu A'))
  })

  it('surfaces a failed rename rather than showing a name that was not saved', async () => {
    updateZone.mockRejectedValue(new Error('không đổi tên được'))
    const input = await openDates()
    await userEvent.clear(input)
    await userEvent.type(input, 'Khu B')
    await userEvent.tab()

    expect(await screen.findByText('không đổi tên được')).toBeInTheDocument()
  })

  it('writes once when Enter and blur overlap, and takes the next rename after it lands', async () => {
    let settle!: () => void
    updateZone.mockReturnValueOnce(new Promise<void>((resolve) => { settle = resolve }))
    const input = await openDates()
    await userEvent.clear(input)
    await userEvent.type(input, 'Khu B{Enter}')
    await userEvent.tab()

    expect(updateZone).toHaveBeenCalledTimes(1)

    settle()
    await waitFor(() => expect(listDeckZones).toHaveBeenCalledTimes(2))

    await userEvent.clear(input)
    await userEvent.type(input, 'Khu C{Enter}')
    await waitFor(() => expect(updateZone).toHaveBeenCalledWith('z1', { name: 'Khu C — Tháo giáo' }))
    expect(updateZone).toHaveBeenCalledTimes(2)
  })
})

/**
 * RV6-14..16 -- comparing the deck between two dates.
 *
 * "Xem được tiến độ của 2 ngày khác nhau": the panel could already hold two
 * coats against each other, and could only ever show them as they are NOW.
 * Each layer now takes a date, and the history in `cell_events` says where
 * every bay stood at the end of it.
 */
describe('DeckProgressPanel — comparing two dates (RV6-14..16)', () => {
  /**
   * The deck's whole history. By the end of 10/09 only R1C1 had been started,
   * at the first coat; everything else on this deck happened after.
   */
  const HISTORY = [
    {
      id: 1, deckName: 'Cellar Deck', cellCode: 'R1C1', cellAreaM2: 500,
      workName: 'Công việc chính', toStageName: 'Blast + Coat 1',
      at: '2026-09-02T03:00:00Z', byId: null, note: '',
    },
    {
      id: 2, deckName: 'Cellar Deck', cellCode: 'R1C2', cellAreaM2: 500,
      workName: 'Công việc chính', toStageName: 'Coat 2',
      at: '2026-09-12T03:00:00Z', byId: null, note: '',
    },
    {
      id: 3, deckName: 'Cellar Deck', cellCode: 'R1C1', cellAreaM2: 500,
      workName: 'Công việc chính', toStageName: 'Tháo giáo',
      at: '2026-09-13T03:00:00Z', byId: null, note: '',
    },
  ]

  beforeEach(() => {
    listDeckEvents.mockResolvedValue(HISTORY)
  })

  /** The day input of one layer's picker. */
  const dateInput = (side: 'a' | 'b') =>
    within(screen.getByTestId(`lens-${side}-date`)).getByPlaceholderText('Hôm nay')

  const pickDate = async (side: 'a' | 'b', text: string) => {
    await userEvent.type(dateInput(side), text)
    await userEvent.keyboard('{Enter}')
    await applyBarOf(dateInput(side))
  }

  it('gives every layer a date picker, empty for the live state', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    expect(dateInput('a')).toHaveValue('')
    // Nothing is read until a date is actually asked for.
    expect(listDeckEvents).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('So sánh hai lớp'))
    await screen.findByTestId('lens-B')
    expect(dateInput('b')).toHaveValue('')
  })

  it('reads the deck\'s history once, however many layers are pinned to a date', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickDate('a', '10/09/2026')
    await waitFor(() => expect(listDeckEvents).toHaveBeenCalledWith('d1'))

    await userEvent.click(screen.getByText('So sánh hai lớp'))
    await screen.findByTestId('lens-B')
    await pickDate('b', '13/09/2026')

    // One read per deck, kept for both layers: the history does not change
    // between two dates of the same deck.
    await waitFor(() => expect(screen.getAllByText(/Trạng thái ngày/)).toHaveLength(2))
    expect(listDeckEvents).toHaveBeenCalledTimes(1)
  })

  it('colours the bays by where they stood at the end of the day picked', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    // Live, both bays are past Blast + Coat 1, so both are filled.
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#fadb14')
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#fadb14')

    await pickDate('a', '10/09/2026')

    // R1C2 was not started until the 12th.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', ''))
    expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#fadb14')
  })

  it('says which day the layer is showing, and how far back the history goes', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    expect(screen.queryByText(/Trạng thái ngày/)).not.toBeInTheDocument()

    await pickDate('a', '10/09/2026')

    const lens = await screen.findByTestId('lens-A')
    expect(await within(lens).findByText('Trạng thái ngày 10/09/2026')).toBeInTheDocument()
    // Rows older than the work model name no work; the layer admits the gap,
    // on the day line's (?) (CPY-01).
    const tip = within(lens).getByRole('img', { name: 'Lịch sử từ 24/08/2026' })
    expect(tip.parentElement).toHaveTextContent(/^Trạng thái ngày 10\/09\/2026$/)
    expect(within(lens).queryByText('Lịch sử từ 24/08/2026')).toBeNull()
  })

  it('counts the as-of bays in the chips and the m² line, not the live ones', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickDate('a', '10/09/2026')

    const lens = await screen.findByTestId('lens-A')
    await waitFor(() =>
      expect(within(screen.getByTestId('lens-chips-A')).getByText('50,00%')).toBeInTheDocument())
    expect(within(lens).getByText('500,00 / 1.000,00 m²')).toBeInTheDocument()
  })

  it('goes back to the live deck when the date is cleared, without re-reading', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickDate('a', '10/09/2026')
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', ''))

    await userEvent.click(
      screen.getByTestId('lens-a-date').querySelector('.ant-picker-clear') as HTMLElement,
    )
    await applyBarOf(dateInput('a'))

    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#fadb14'))
    expect(screen.queryByText(/Trạng thái ngày/)).not.toBeInTheDocument()
    expect(listDeckEvents).toHaveBeenCalledTimes(1)
  })

  it('refuses a day that has not happened yet, by the Vietnam day like every other "today"', async () => {
    // 18:30Z on the 15th is already 01:30 on the 16th in Vietnam. The dashboard,
    // the Năng suất sheet and the GS card all call that the 16th (effortDayKey,
    // RV5-20); a picker that asked the browser's clock instead would refuse the
    // 16th on any machine west of UTC+7 while the site is already working it.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-09-15T18:30:00Z') })
    try {
      renderPanel()
      await screen.findByTestId('lens-A')
      await userEvent.click(dateInput('a'))

      const cellOf = (day: string) => document.querySelector(
        `.ant-picker-dropdown td[title="${day}"]`,
      ) as HTMLElement
      expect(cellOf('2026-09-16')).not.toHaveClass('ant-picker-cell-disabled')
      expect(cellOf('2026-09-17')).toHaveClass('ant-picker-cell-disabled')
    } finally {
      vi.useRealTimers()
    }
  })

  it('still answers the plan toggle on a layer pinned to a date', async () => {
    listDeckZones.mockResolvedValue([{ ...ZONE, stageId: 's1', cellIds: ['c1', 'c2'] }])
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickDate('a', '10/09/2026')
    await waitFor(() =>
      expect(screen.getByTestId('canvas')).toHaveAttribute('data-labels', 'Khu A — Tháo giáo'))

    await userEvent.click(screen.getByRole('switch', { name: 'Hiện kế hoạch' }))
    // RV6-12 off: the coat's own colour on what was done by then, nothing else.
    await waitFor(() =>
      expect(screen.getByTestId('cell-R1C1')).toHaveAttribute('data-color', '#fadb14'))
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '')
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-labels', '')
  })

  it('reports a history that could not be read, and keeps drawing the live deck', async () => {
    listDeckEvents.mockRejectedValue(new Error('không đọc được lịch sử'))
    renderPanel()
    await screen.findByTestId('lens-A')
    await pickDate('a', '10/09/2026')

    expect(await screen.findByText('không đọc được lịch sử')).toBeInTheDocument()
    expect(screen.getByTestId('cell-R1C2')).toHaveAttribute('data-color', '#fadb14')
  })
})

/**
 * RV6-17 -- "tách bộ lọc 2 bên trái phải nằm trên layout".
 *
 * Two layers with one shared row of controls above them meant reading across
 * two selects to work out which drawing a change would land on. In the split
 * view each layer's stage select and date picker now sit in that layer's own
 * pane, above its drawing; on a single layer the pair stays where it was.
 */
describe('DeckProgressPanel — each layer\'s controls above its own drawing (RV6-17)', () => {
  it('keeps the single layer\'s controls in the row above the drawing', async () => {
    renderPanel()
    const lens = await screen.findByTestId('lens-A')
    expect(lens).not.toContainElement(document.getElementById('lens-a-stage'))
    expect(lens).not.toContainElement(screen.getByTestId('lens-a-date'))
    // ...and they are still on the panel, reachable by their labels.
    expect(screen.getByLabelText('Lớp sơn đang xem')).toBeInTheDocument()
  })

  it('puts each layer\'s stage select and date picker in its own pane when comparing', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByText('So sánh hai lớp'))
    const lensB = await screen.findByTestId('lens-B')
    const lensA = screen.getByTestId('lens-A')

    expect(lensA).toContainElement(document.getElementById('lens-a-stage'))
    expect(lensA).toContainElement(screen.getByTestId('lens-a-date'))
    expect(lensB).toContainElement(document.getElementById('lens-b-stage'))
    expect(lensB).toContainElement(screen.getByTestId('lens-b-date'))

    // The controls still work from their new place: the right layer moves
    // to another coat without touching the left one.
    await userEvent.click(within(lensB).getByLabelText('Công đoạn'))
    await userEvent.click(await screen.findByTitle('Coat 2'))
    await applyBarOf(within(lensB).getByLabelText('Công đoạn'))
    expect(within(lensB).getByText('Tiến độ · Coat 2')).toBeInTheDocument()
    expect(within(lensA).getByText('Tiến độ · Blast + Coat 1')).toBeInTheDocument()
  })
})

describe('DeckProgressPanel — the lens bar is a draft, applied on Tìm (FLT-08)', () => {
  /** The bar that holds a control. */
  const barOf = (el: HTMLElement) => el.closest('[role="search"]') as HTMLElement

  it('ends the single layer\'s bar with Đặt lại · Tìm, and changes the lens only on Tìm', async () => {
    renderPanel()
    const lens = await screen.findByTestId('lens-A')
    const bar = barOf(screen.getByLabelText('Lớp sơn đang xem'))
    expect(bar).toContainElement(screen.getByTestId('lens-a-date'))
    const buttons = within(bar).getAllByRole('button').filter((b) => /Đặt lại|Tìm/.test(b.textContent ?? ''))
    expect(buttons.map((b) => b.textContent)).toEqual(['Đặt lại', 'Tìm'])

    await userEvent.click(screen.getByLabelText('Lớp sơn đang xem'))
    await userEvent.click(await screen.findByTitle('Coat 2'))
    // Not yet: the draft only.
    expect(within(lens).getByText('Tiến độ · Blast + Coat 1')).toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: /Tìm/ }))
    expect(await within(lens).findByText('Tiến độ · Coat 2')).toBeInTheDocument()
  })

  it('puts the first coat and today back, applied at once, on Đặt lại', async () => {
    listDeckEvents.mockResolvedValue([])
    renderPanel()
    const lens = await screen.findByTestId('lens-A')
    await pickLens('Lớp sơn đang xem', 'Coat 2')
    expect(await within(lens).findByText('Tiến độ · Coat 2')).toBeInTheDocument()
    await userEvent.click(within(barOf(screen.getByLabelText('Lớp sơn đang xem'))).getByRole('button', { name: 'Đặt lại' }))
    expect(await within(lens).findByText('Tiến độ · Blast + Coat 1')).toBeInTheDocument()
    expect(within(screen.getByTestId('lens-a-date')).getByPlaceholderText('Hôm nay')).toHaveValue('')
  })

  it('offers the draft work\'s coats before Tìm, and applies the work with them', async () => {
    loadDeckWorks.mockResolvedValue(TWO_WORKS)
    renderPanel(false)
    const lens = await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByLabelText('Công việc'))
    await userEvent.click(await screen.findByTitle('Tháo giáo'))
    // The lens still shows the first work; the coat select already offers the second's.
    expect(within(lens).getByText('Tiến độ · Blast + Coat 1')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Lớp sơn đang xem'))
    const coatOptions = () => Array.from(
      (document.getElementById('lens-a-stage_list') as HTMLElement).closest('.ant-select-dropdown')!
        .querySelectorAll('.ant-select-item-option'),
      (el) => el.getAttribute('title'),
    )
    await waitFor(() => expect(coatOptions()).toEqual(['Tất cả công đoạn', 'Tháo giáo lửng']))
    await userEvent.keyboard('{Escape}')
    await applyBarOf(screen.getByLabelText('Công việc'))
    expect(await within(lens).findByText('Tiến độ · Tháo giáo lửng')).toBeInTheDocument()
  })

  it('gives each layer its own bar when comparing: Tìm on one leaves the other\'s draft alone', async () => {
    renderPanel()
    await screen.findByTestId('lens-A')
    await userEvent.click(screen.getByText('So sánh hai lớp'))
    const lensB = await screen.findByTestId('lens-B')
    const lensA = screen.getByTestId('lens-A')
    const barA = barOf(within(lensA).getByLabelText('Công đoạn'))
    const barB = barOf(within(lensB).getByLabelText('Công đoạn'))
    expect(barA).not.toBe(barB)
    expect(barA).toHaveAccessibleName('Bộ lọc bên trái')
    expect(barB).toHaveAccessibleName('Bộ lọc bên phải')

    await userEvent.click(within(lensA).getByLabelText('Công đoạn'))
    await userEvent.click(await screen.findByTitle('Coat 2'))
    await userEvent.click(within(lensB).getByLabelText('Công đoạn'))
    const popups = document.querySelectorAll<HTMLElement>('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    await userEvent.click(within(popups[popups.length - 1]).getByTitle('Blast + Coat 1'))
    await userEvent.click(within(barB).getByRole('button', { name: /Tìm/ }))
    expect(await within(lensB).findByText('Tiến độ · Blast + Coat 1')).toBeInTheDocument()
    // A's pick is still a draft.
    expect(within(lensA).getByText('Tiến độ · Blast + Coat 1')).toBeInTheDocument()
    await userEvent.click(within(barA).getByRole('button', { name: /Tìm/ }))
    expect(await within(lensA).findByText('Tiến độ · Coat 2')).toBeInTheDocument()
  })
})

describe('DeckProgressPanel: the work\'s unit (RV6-35)', () => {
  it('labels every figure in the active work\'s own unit, not m²', async () => {
    // Linh, item 3: the unit belongs to the work. A scaffolding work counted
    // in tonnes reads "tấn" on the ring, the coats, the footer, the zone rows
    // and the m² line -- the numbers themselves do not move (RV6-38).
    loadDeckWorks.mockResolvedValue({
      ...ENTRY,
      works: [{ ...ENTRY.works[0], work: { ...WORK, quantityLabel: 'Khối lượng', unit: 'tấn' } }],
    })
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    expect(within(ring).getAllByText('1.000,00 / 1.000,00 tấn')).toHaveLength(2)
    expect(within(ring).getByText('500,00 / 1.000,00 tấn')).toBeInTheDocument()
    expect(within(ring).getAllByText('1.000,00 tấn')).toHaveLength(2)
    expect(screen.getAllByText('1.000,00 / 1.000,00 tấn').length).toBeGreaterThan(2)
    expect(screen.queryByText(/m²/)).toBeNull()
    expect(screen.getByRole('row', { name: /^tấn/ })).toBeInTheDocument()
  })
})
