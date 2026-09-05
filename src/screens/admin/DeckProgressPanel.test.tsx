import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckProgressPanel } from './DeckProgressPanel'

const loadDeckWorks = vi.hoisted(() => vi.fn())
const getDrawingUrl = vi.hoisted(() => vi.fn())
const listDeckZones = vi.hoisted(() => vi.fn())
const createZone = vi.hoisted(() => vi.fn())
const updateZone = vi.hoisted(() => vi.fn())
const deleteZone = vi.hoisted(() => vi.fn())
const setZoneActual = vi.hoisted(() => vi.fn())
const listCellNotes = vi.hoisted(() => vi.fn())
const setReportNote = vi.hoisted(() => vi.fn())
const subscribeDeckStates = vi.hoisted(() => vi.fn())

vi.mock('../../lib/progressApi', () => ({
  loadDeckWorks: (id: string) => loadDeckWorks(id),
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
}))

// Konva renders to a canvas, which jsdom does not implement. The double exposes
// what this panel is responsible for putting on one: which drawing, what colour
// each bay came out, what is selected, and what the plan says.
vi.mock('../../canvas/DrawingCanvas', () => ({
  DrawingCanvas: ({
    imageUrl, cells, cellColors, hatchedCodes, markedCodes, planLabels, selectedCodes,
    outlineColors, cellOpacities, onCellClick, onSelectDraw,
  }: {
    imageUrl: string
    cells: { code: string }[]
    cellColors?: Record<string, string>
    outlineColors?: Record<string, string>
    cellOpacities?: Record<string, number>
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
  ),
}))

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.6 },
]

const WORK = {
  id: 'w1', projectId: 'p1', seq: 1, name: 'Công việc chính', kind: 'bays' as const,
  weight: 1, counts: true, manualProgress: 0,
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

/** The stage the left lens is showing, by name. */
const pickLens = async (label: string, name: string) => {
  await userEvent.click(screen.getByLabelText(label))
  await userEvent.click(await screen.findByTitle(name))
}

describe('DeckProgressPanel', () => {
  it('loads the deck it was given', async () => {
    renderPanel()
    await waitFor(() => expect(loadDeckWorks).toHaveBeenCalledWith('d1'))
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

  it('says what the ring itself answers, so it is not read as the cumulative list', async () => {
    renderPanel()
    const ring = await screen.findByTestId('stage-ring')
    expect(
      within(ring).getByText('Vòng tròn: diện tích đang dừng ở mỗi lớp, không cộng dồn'),
    ).toBeInTheDocument()
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
    expect(await screen.findByText(/ô chưa đạt, chưa kế hoạch để trắng/)).toBeInTheDocument()
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

describe('DeckProgressPanel — công việc', () => {
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

  beforeEach(() => {
    loadDeckWorks.mockResolvedValue(TWO_WORKS)
  })

  it('offers the works the deck is part of, opening on the first', async () => {
    renderPanel(false)
    await screen.findByTestId('lens-A')
    expect(screen.getByLabelText('Công việc')).toBeInTheDocument()
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
  })
})
