import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { consequenceItems, keyFactTexts, pageSubtitle } from '../../test/copy'
import { chooseOption, optionTitles } from '../../test/select'
import { DeckDetailScreen } from './DeckDetailScreen'

const getDeck = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())
const createDeck = vi.hoisted(() => vi.fn())
const updateDeckIdentity = vi.hoisted(() => vi.fn())
const updateDeckArea = vi.hoisted(() => vi.fn())
const reprorateDeckCells = vi.hoisted(() => vi.fn())
const uploadDrawing = vi.hoisted(() => vi.fn())
const pdfPageCount = vi.hoisted(() => vi.fn())
const renderPdfPage = vi.hoisted(() => vi.fn())

vi.mock('../../lib/decksApi', () => ({
  getDeck: (id: string) => getDeck(id),
  listDecks: (p: string) => listDecks(p),
  createDeck: (i: unknown) => createDeck(i),
  updateDeckIdentity: (a: string, b: string, c: string) => updateDeckIdentity(a, b, c),
  updateDeckArea: (a: string, b: number, c: string) => updateDeckArea(a, b, c),
  reprorateDeckCells: (a: string, b: number) => reprorateDeckCells(a, b),
  uploadDrawing: (...args: unknown[]) => uploadDrawing(...args),
}))
vi.mock('../../lib/pdfToPng', () => ({
  pdfPageCount: (f: File) => pdfPageCount(f),
  renderPdfPage: (f: File, n: number) => renderPdfPage(f, n),
  PDF_RENDER_WIDTH: 2000,
}))
// The drawing tools are their own screen with their own tests; here all that
// matters is whether they are on the page and which deck they were handed.
vi.mock('./DeckEditor', () => ({
  DeckEditor: ({ deck, editable, quantityLabel, unit }: {
    deck: { code: string }; editable?: boolean; quantityLabel?: string; unit?: string | null
  }) => (
    <div>{`editor ${deck.code} ${editable ? 'sửa' : 'xem'} ${quantityLabel ?? '?'}/${unit === null ? 'none' : unit ?? '?'}`}</div>
  ),
}))
// Stubbed for the same reason DeckEditor is: this file is about the deck's own
// form, and the panel has its own test file. Left real it would pull decksApi's
// stage exports through a mock that does not carry them.
vi.mock('./StageConfigPanel', () => ({
  StageConfigPanel: ({ workId, deckId, editable, workSelect }: {
    workId: string; deckId: string; editable?: boolean; workSelect?: ReactNode
  }) => (
    <div data-testid={`stage-panel-${workId}`}>
      <span>{`stages ${workId} ${deckId} ${editable ? 'sửa' : 'xem'}`}</span>
      {workSelect}
    </div>
  ),
}))
// The works the deck is part of, which A3.2 chooses between since 0024.
const listDeckWorks = vi.hoisted(() => vi.fn())
vi.mock('../../lib/gsApi', () => ({ listDeckWorks: (id: string) => listDeckWorks(id) }))
const WORK1 = {
  id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays' as const, weight: 0.6, counts: true, manualProgress: 0, quantityLabel: 'Diện tích', unit: 'm²',
}
const WORK2 = { ...WORK1, id: 'w2', seq: 2, name: 'Tháo giáo', weight: 0.4 }
// Stubbed like the other two, and for one more reason: left real it calls
// loadDeckWorks against the live client, so every test in this file paid a
// network round trip for a panel none of them are about. The stub reports a
// fixed percentage upward, which is the contract this screen depends on.
// The deck's history is read here now and handed to the two panels below.
const listDeckEvents = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  listDeckEvents: (id: string) => listDeckEvents(id),
}))
vi.mock('./EffortHistoryPanel', () => ({
  EffortHistoryPanel: ({ events }: { events: unknown[] | null }) => (
    <div>giờ công {events === null ? 'đang tải' : `${events.length} lần`}</div>
  ),
}))
vi.mock('./DeckForecastPanel', () => ({
  DeckForecastPanel: ({ deckId }: { deckId: string }) => <div>dự báo {deckId}</div>,
}))
vi.mock('./DeckProgressPanel', () => ({
  DeckProgressPanel: ({
    deckId,
    onProgress,
  }: {
    deckId: string
    onProgress?: (p: number | null) => void
  }) => {
    useEffect(() => onProgress?.(0.4438), [onProgress])
    return <div>progress {deckId}</div>
  },
}))

const DECK = {
  id: 'd1', projectId: 'p1', seq: 1, name: 'Main Deck', code: 'MD',
  imagePath: 'p1/d1.png', imageW: 2000, imageH: 1414,
  drawingName: 'ban-ve.pdf', drawingPage: null,
  totalAreaM2: 5258.5, areaSource: 'prorated' as const, cellCount: 24,
}

beforeEach(() => {
  listDeckEvents.mockReset()
  listDeckEvents.mockResolvedValue([{ id: 1 }, { id: 2 }])
  for (const m of [getDeck, listDecks, createDeck, updateDeckIdentity, updateDeckArea, reprorateDeckCells, uploadDrawing, pdfPageCount, renderPdfPage]) {
    m.mockReset()
  }
  getDeck.mockResolvedValue(DECK)
  listDecks.mockResolvedValue([DECK])
  createDeck.mockResolvedValue('d9')
  updateDeckIdentity.mockResolvedValue(undefined)
  updateDeckArea.mockResolvedValue(undefined)
  reprorateDeckCells.mockResolvedValue(undefined)
  uploadDrawing.mockResolvedValue(undefined)
  pdfPageCount.mockResolvedValue(1)
  renderPdfPage.mockResolvedValue({ blob: new Blob(['x']), width: 2000, height: 1414 })
  listDeckWorks.mockReset()
  listDeckWorks.mockResolvedValue([{ work: WORK1, weight: 1, stages: [] }])
})

const renderAt = (path: string) =>
  renderApp(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/decks" element={<div>deck list</div>} />
        <Route path="/decks/:deckId" element={<DeckDetailScreen />} />
      </Routes>
    </MemoryRouter>,
  )

const pdfFile = () => new File(['%PDF-1.4'], 'deck.pdf', { type: 'application/pdf' })

/** The facts beside the page title (HLT-01). */
const headerFacts = () => keyFactTexts(screen.getByRole('heading', { level: 1 }).parentElement as HTMLElement)
/** The card a heading titles. */
const cardOf = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement

describe('DeckDetailScreen', () => {
  it('opens the deck named in the URL, so a reload keeps it', async () => {
    renderAt('/decks/d1')

    // The name is the page heading and the code is the badge beside it --
    // two nodes, deliberately: the code is a stable identifier the admin reads
    // off a drawing, and it stays legible while a long deck name truncates.
    expect(await screen.findByRole('heading', { level: 1, name: 'Main Deck' })).toBeInTheDocument()
    // Twice: the badge beside the heading, which stays legible while a long
    // deck name truncates, and the identity card that lists it as a field.
    expect(screen.getAllByText('MD')).toHaveLength(2)
    expect(getDeck).toHaveBeenCalledWith('d1')
  })

  it('shows the deck read-only until the admin asks to edit', async () => {
    // Curating a deck is destructive work -- detection replaces every cell --
    // and the screen a link lands on should not be one keystroke away from it.
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })

    // Every panel is on screen in Xem -- the stage spec and the bay mesh are
    // what the deck's percentages are computed from, so reading them must not
    // require entering a mode that can overwrite them. What Xem withholds is
    // the writing: no file picker, and both panels told they are read-only.
    expect(screen.queryByLabelText('Bản vẽ (PDF)')).not.toBeInTheDocument()
    expect(screen.getByText(/^editor MD xem/)).toBeInTheDocument()
    expect(await screen.findByText('stages w1 d1 xem')).toBeInTheDocument()

    // The Segmented's radio input carries pointer-events:none -- its visible
    // label is what a person clicks, so that is what the test clicks.
    await userEvent.click(screen.getByText('Sửa'))

    expect(await screen.findByLabelText('Bản vẽ (PDF)')).toBeInTheDocument()
    expect(screen.getByText(/^editor MD sửa/)).toBeInTheDocument()
    expect(await screen.findByText('stages w1 d1 sửa')).toBeInTheDocument()
  })

  it('names the file the drawing came from', async () => {
    // The stored image is a render named from ids, so "Đã có" was the whole of
    // what the admin got back. On a project whose sheets are all called things
    // like 00171-14, that is not a small thing to be unsure about.
    renderAt('/decks/d1')

    // Scoped to the identity cards: the panel header repeats the same label as
    // its collapsed summary, which is the point of a summary, so an unscoped
    // query cannot say which of the two it found.
    const identity = await screen.findByTestId('deck-identity')
    expect(within(identity).getByText('ban-ve.pdf')).toBeInTheDocument()
  })

  it('sets every identity value at one size, and wraps a file name between words (M4)', async () => {
    getDeck.mockResolvedValue({ ...DECK, drawingName: 'ban-ve.pdf', drawingPage: null })
    renderAt('/decks/d1')
    const identity = await screen.findByTestId('deck-identity')
    const values = [
      within(identity).getByText('Main Deck'),
      within(identity).getByText(DECK.code),
      within(identity).getByText('ban-ve.pdf'),
    ]
    for (const v of values) {
      expect(v).toHaveStyle({ fontSize: '15px', fontWeight: '600', overflowWrap: 'anywhere' })
      expect(v.style.wordBreak).not.toBe('break-all')
    }
  })

  it('says which page of a multi-page file was taken', async () => {
    getDeck.mockResolvedValue({ ...DECK, drawingName: 'ban-ve.pdf', drawingPage: 3 })
    renderAt('/decks/d1')

    const identity = await screen.findByTestId('deck-identity')
    expect(within(identity).getByText('ban-ve.pdf (trang 3)')).toBeInTheDocument()
    // The card's fact names the same file (HLT-01).
    expect(keyFactTexts(cardOf('Thông tin sàn & bản vẽ'))).toEqual(['ban-ve.pdf (trang 3)'])
  })

  it('admits it does not know, on a deck whose drawing predates recording it', async () => {
    // Every deck that already had a drawing has one whose origin nobody
    // recorded. Inventing a name would be worse than saying so.
    getDeck.mockResolvedValue({ ...DECK, drawingName: null, drawingPage: null })
    renderAt('/decks/d1')

    const identity = await screen.findByTestId('deck-identity')
    expect(within(identity).getByText('Đã có (không rõ tên tệp)')).toBeInTheDocument()
  })

  it('shows what is on the deck now, above the picker that would replace it', async () => {
    // Choosing a file is destructive on a deck that already has one.
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    // The Segmented's radio input carries pointer-events:none -- its visible
    // label is what a person clicks, so that is what the test clicks.
    await userEvent.click(screen.getByText('Sửa'))

    expect(await screen.findByText('Đang dùng: ban-ve.pdf')).toBeInTheDocument()
  })

  it('records what the uploaded file was called', async () => {
    renderAt('/decks/new?project=p1')

    await userEvent.type(await screen.findByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.upload(screen.getByLabelText('Bản vẽ (PDF)'), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))

    await waitFor(() => expect(uploadDrawing).toHaveBeenCalled())
    expect(uploadDrawing.mock.calls[0][5]).toEqual({ name: 'deck.pdf', page: null })
  })

  it('reads a dot in the page number as a thousands separator, not a decimal point', async () => {
    // With no parser antd read "1.230" as page 1.23, a page that does not exist.
    pdfPageCount.mockResolvedValue(2000)
    renderAt('/decks/new?project=p1')

    await userEvent.type(await screen.findByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.upload(screen.getByLabelText('Bản vẽ (PDF)'), pdfFile())
    await screen.findByText('Tệp có 2000 trang')
    await userEvent.type(screen.getByLabelText('Trang'), '{Backspace}1.230')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))

    await waitFor(() => expect(uploadDrawing).toHaveBeenCalled())
    expect(uploadDrawing.mock.calls[0][5]).toEqual({ name: 'deck.pdf', page: 1230 })
  })

  it('keeps the page whole when a comma is typed in it', async () => {
    // "2,5" used to lose its comma and read as page 25.
    pdfPageCount.mockResolvedValue(30)
    renderAt('/decks/new?project=p1')

    await userEvent.type(await screen.findByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.upload(screen.getByLabelText('Bản vẽ (PDF)'), pdfFile())
    await screen.findByText('Tệp có 30 trang')
    await userEvent.type(screen.getByLabelText('Trang'), '{Backspace}2,5')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))

    await waitFor(() => expect(uploadDrawing).toHaveBeenCalled())
    expect(uploadDrawing.mock.calls[0][5]).toEqual({ name: 'deck.pdf', page: 2 })
  })

  it('records the page too, when the file had more than one', async () => {
    pdfPageCount.mockResolvedValue(3)
    renderAt('/decks/new?project=p1')

    await userEvent.type(await screen.findByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.upload(screen.getByLabelText('Bản vẽ (PDF)'), pdfFile())
    await screen.findByText('Tệp có 3 trang')
    await userEvent.type(screen.getByLabelText('Trang'), '{Backspace}2')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))

    await waitFor(() => expect(uploadDrawing).toHaveBeenCalled())
    expect(uploadDrawing.mock.calls[0][5]).toEqual({ name: 'deck.pdf', page: 2 })
  })

  it('takes PDFs and nothing else', async () => {
    // A drawing that arrives as a photo or a screenshot has already lost the
    // dashed beam centrelines detection reads, and no message afterwards
    // explains why the deck came back with a tenth of its bays.
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    // The Segmented's radio input carries pointer-events:none -- its visible
    // label is what a person clicks, so that is what the test clicks.
    await userEvent.click(screen.getByText('Sửa'))

    expect(await screen.findByLabelText('Bản vẽ (PDF)')).toHaveAttribute('accept', 'application/pdf')
  })

  it('writes the name, the code and the area together', async () => {
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    // The Segmented's radio input carries pointer-events:none -- its visible
    // label is what a person clicks, so that is what the test clicks.
    await userEvent.click(screen.getByText('Sửa'))

    const name = await screen.findByLabelText('Tên sàn')
    await userEvent.clear(name)
    await userEvent.type(name, 'Cellar Deck')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))

    await waitFor(() => expect(updateDeckIdentity).toHaveBeenCalledWith('d1', 'Cellar Deck', 'MD'))
    expect(updateDeckArea).toHaveBeenCalledWith('d1', 5258.5, 'prorated')
  })

  it('re-prorates every bay right after writing the new total, on a deck that has bays', async () => {
    // DECK.cellCount is 24. RV6-19: this runs on every such save, not only
    // when the area actually changed, so a deck whose bays already disagree
    // with its total is repaired by the next save.
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))

    await waitFor(() => expect(reprorateDeckCells).toHaveBeenCalledWith('d1', 5258.5))
    // updateDeckArea first, then the cells: a failure between the two should
    // leave the total right and the bays stale, not the other way round.
    expect(updateDeckArea.mock.invocationCallOrder[0])
      .toBeLessThan(reprorateDeckCells.mock.invocationCallOrder[0])
  })

  it('does not re-prorate a deck with no bays yet', async () => {
    getDeck.mockResolvedValue({ ...DECK, cellCount: 0 })
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))

    await waitFor(() => expect(updateDeckArea).toHaveBeenCalled())
    expect(reprorateDeckCells).not.toHaveBeenCalled()
  })

  it('never re-prorates while creating a deck', async () => {
    renderAt('/decks/new?project=p1')

    await userEvent.type(await screen.findByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))

    await waitFor(() => expect(createDeck).toHaveBeenCalled())
    expect(reprorateDeckCells).not.toHaveBeenCalled()
  })

  it('surfaces a re-prorate failure through the same error path as any other save failure', async () => {
    reprorateDeckCells.mockRejectedValue(new Error('re-prorate failed'))
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))

    expect(await screen.findByText('re-prorate failed')).toBeInTheDocument()
  })

  it('asks before replacing a drawing that already has bays on it', async () => {
    // uploadDrawing swaps the image and leaves cells.x/y untouched, so a mesh
    // traced against the old sheet lands wherever those fractions fall on the
    // new one. Nothing afterwards says the bays moved; the drawing simply looks
    // subtly wrong, and every area under it is already being billed.
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))
    // Said before a file is chosen, and true of the code: the image is
    // replaced, the bays stay (uploadDrawing touches no cell) (RUL-01).
    expect(screen.getByText('Tệp mới thay bản vẽ hiện tại và giữ nguyên các ô đã dựng.')).toBeInTheDocument()
    expect(screen.queryByText(/xoá bản vẽ hiện tại và toàn bộ hình học ô/)).toBeNull()
    await userEvent.upload(await screen.findByLabelText('Bản vẽ (PDF)'), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))

    expect(await screen.findByText('Lưu thay đổi cho sàn này?')).toBeInTheDocument()
    // One helper sentence, no reasoning (RUL-01); the panel named as the admin
    // sees it, not by its mockup code (CPY-04).
    expect(consequenceItems()).toEqual(['Ô đã dựng giữ vị trí cũ trên bản vẽ mới, cần kiểm tra lại ở Phân ô'])
    expect(screen.queryByText(/A3\.3/)).not.toBeInTheDocument()
    expect(uploadDrawing).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(uploadDrawing).toHaveBeenCalled())
  })

  it('asks before an area change re-prorates every bay under it', async () => {
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))
    const area = await screen.findByLabelText('Diện tích sàn (m²)')
    await userEvent.clear(area)
    await userEvent.type(area, '6000')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))

    expect(await screen.findByText('Lưu thay đổi cho sàn này?')).toBeInTheDocument()
    expect(consequenceItems()).toEqual([
      'Diện tích từng ô được chia lại theo con số mới',
      // The done m², the KPI actuals and the report read the cells' areas.
      'Diện tích đã làm, KPI thực hiện và báo cáo tính theo diện tích sàn mới',
    ])
    expect(screen.queryByText(/mẫu số/)).toBeNull()
    expect(screen.queryByText(/pixel/)).not.toBeInTheDocument()
    expect(updateDeckArea).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(updateDeckArea).toHaveBeenCalledWith('d1', 6000, 'prorated'))
  })

  it('reads an area typed with thousands dots and a decimal comma', async () => {
    // decimalSeparator="," alone replaced the comma but kept the dots, so
    // "6.000,5" never parsed and the field kept the "6.000" it had read on
    // the way -- a deck of 6 m² instead of 6000.5.
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))
    const area = await screen.findByLabelText('Diện tích sàn (m²)')
    await userEvent.clear(area)
    await userEvent.type(area, '6.000,5')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(updateDeckArea).toHaveBeenCalledWith('d1', 6000.5, 'prorated'))
  })

  it('reads "6.000" in the area as six thousand m², not six', async () => {
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))
    const area = await screen.findByLabelText('Diện tích sàn (m²)')
    await userEvent.clear(area)
    await userEvent.type(area, '6.000')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(updateDeckArea).toHaveBeenCalledWith('d1', 6000, 'prorated'))
  })

  it('shows the area with a decimal comma and no grouping, so an edit keeps its magnitude', async () => {
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))

    expect(await screen.findByLabelText('Diện tích sàn (m²)')).toHaveValue('5258,5')
  })

  it('says the deck was saved, because the form looks the same afterwards', async () => {
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))
    const name = await screen.findByLabelText('Tên sàn')
    await userEvent.clear(name)
    await userEvent.type(name, 'Cellar Deck')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))

    await waitFor(() => expect(updateDeckIdentity).toHaveBeenCalled())
    expect(await screen.findByText('Đã lưu thông tin sàn')).toBeInTheDocument()
  })

  it('creates a deck from the form and goes to its own address', async () => {
    // No modal: creating a deck asks for the same four things editing one does,
    // and a dialog that asked for two of them left the other two to be found
    // somewhere else afterwards.
    renderAt('/decks/new?project=p1')

    await userEvent.type(await screen.findByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))

    await waitFor(() => expect(createDeck).toHaveBeenCalledWith({
      projectId: 'p1', seq: 2, name: 'Cellar Deck', code: 'CD',
    }))
    // Straight to the deck it just made, replacing the create form in history
    // so Back does not offer to make it again.
    await waitFor(() => expect(getDeck).toHaveBeenCalledWith('d9'))
  })

  it('uploads the drawing as part of creating the deck', async () => {
    renderAt('/decks/new?project=p1')

    await userEvent.type(await screen.findByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.upload(screen.getByLabelText('Bản vẽ (PDF)'), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))

    await waitFor(() => expect(uploadDrawing).toHaveBeenCalled())
    // The deck exists before the drawing is attached to it: a run that stops in
    // between leaves a deck with no drawing, which the admin can see and
    // finish, rather than a drawing belonging to nothing.
    expect(createDeck).toHaveBeenCalled()
    expect(uploadDrawing.mock.calls[0][0]).toBe('d9')
    expect(uploadDrawing.mock.calls[0][1]).toBe('p1')
  })

  it('asks which page of a multi-page PDF to take', async () => {
    pdfPageCount.mockResolvedValue(3)
    renderAt('/decks/new?project=p1')

    await userEvent.upload(await screen.findByLabelText('Bản vẽ (PDF)'), pdfFile())

    expect(await screen.findByText('Tệp có 3 trang')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Trang'), '{Backspace}2')
    await userEvent.type(screen.getByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))

    await waitFor(() => expect(renderPdfPage.mock.calls[0][1]).toBe(2))
  })

  it('will not create a deck with no name or no code', async () => {
    // Both are how the deck is named everywhere else on the project -- the GS
    // sees the code, the report groups by it.
    renderAt('/decks/new?project=p1')

    expect(await screen.findByRole('button', { name: 'Tạo sàn' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Tên sàn'), 'Cellar Deck')
    expect(screen.getByRole('button', { name: 'Tạo sàn' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    expect(screen.getByRole('button', { name: 'Tạo sàn' })).not.toBeDisabled()
  })

  it('carries the deck percentage in the header, from the panel that already has it', async () => {
    // The alternative is loading every cell and stage of the deck a second
    // time for one number.
    renderAt('/decks/d1')
    expect(await screen.findByText('44,38%')).toBeInTheDocument()
  })

  it('discards unsaved edits when the admin switches back to Xem', async () => {
    // Switching modes is not saving. Leaving the typed value in place would
    // mean the next press of Sửa opens a form that disagrees with the deck.
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await userEvent.click(screen.getByText('Sửa'))

    const nameField = await screen.findByLabelText('Tên sàn')
    await userEvent.clear(nameField)
    await userEvent.type(nameField, 'Nhập nhầm')

    await userEvent.click(screen.getByText('Xem'))
    await userEvent.click(screen.getByText('Sửa'))

    expect(await screen.findByLabelText('Tên sàn')).toHaveValue('Main Deck')
    expect(updateDeckIdentity).not.toHaveBeenCalled()
  })

  it('says so when the id in the URL names no deck', async () => {
    // A stale bookmark, or a deck someone else deleted. Reported rather than
    // left as an empty form the admin might type a whole deck into.
    getDeck.mockResolvedValue(null)
    renderAt('/decks/gone')

    expect(await screen.findByText('Không tìm thấy sàn này.')).toBeInTheDocument()
  })

  it('reports a failed load rather than showing an empty deck', async () => {
    getDeck.mockRejectedValue(new Error('JWT expired'))
    renderAt('/decks/d1')

    expect(await screen.findByText('JWT expired')).toBeInTheDocument()
  })
})

describe('DeckDetailScreen — công việc', () => {
  it('shows one work\'s coats with nothing to choose', async () => {
    renderAt('/decks/d1')
    expect(await screen.findByText('stages w1 d1 xem')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Công việc · Cấu hình lớp sơn' })).toBeNull()
  })

  it('chooses the work of the coat configuration from a searchable select when the deck is in several (FLT-07)', async () => {
    listDeckWorks.mockResolvedValue([{ work: WORK1, weight: 1, stages: [] }, { work: WORK2, weight: 1, stages: [] }])
    renderAt('/decks/d1')
    expect(await screen.findByText('stages w1 d1 xem')).toBeInTheDocument()
    // A select, not a row of tabs.
    expect(screen.queryByRole('tab')).toBeNull()
    // Named by its card, apart from the other cards' work selects, and inside
    // the card it switches (M7).
    expect(within(screen.getByTestId('stage-panel-w1')).getByRole('combobox', { name: 'Công việc · Cấu hình lớp sơn' })).toBeInTheDocument()
    // Searchable, tones ignored (UI-02).
    await userEvent.type(screen.getByRole('combobox', { name: 'Công việc · Cấu hình lớp sơn' }), 'thao')
    expect(await optionTitles('Công việc · Cấu hình lớp sơn')).toEqual(['Tháo giáo'])
    await userEvent.keyboard('{Escape}')
    await chooseOption('Công việc · Cấu hình lớp sơn', 'Tháo giáo')
    expect(await screen.findByText('stages w2 d1 xem')).toBeVisible()
    // The first work's panel stays mounted, hidden, so an unsaved draft
    // survives switching back, as it did under the tabs.
    expect(screen.getByText('stages w1 d1 xem')).not.toBeVisible()
    await chooseOption('Công việc · Cấu hình lớp sơn', 'Sơn')
    expect(screen.getByText('stages w1 d1 xem')).toBeVisible()
    expect(screen.getByText('stages w2 d1 xem')).not.toBeVisible()
  })

  it('points at the Công việc screen when the deck is in no work', async () => {
    listDeckWorks.mockResolvedValue([])
    renderAt('/decks/d1')
    expect(await screen.findByText('Sàn này chưa thuộc công việc nào')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Công việc/ })).toHaveAttribute('href', expect.stringContaining('/admin/works?project=p1'))
    // The next step only; no summary that repeats the title beside it (CPY-01).
    expect(screen.getByText('Gán sàn vào một công việc trước, rồi quay lại đây cấu hình lớp sơn.')).toBeInTheDocument()
    expect(screen.queryByText('Sàn chưa thuộc công việc nào')).not.toBeInTheDocument()
  })

  it('labels the header figure as the deck\'s tổng hợp across works', async () => {
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    // The figure arrives one effect after the panel mounts, so wait for it.
    expect(await screen.findByText('44,38%')).toBeInTheDocument()
    // On the label's (?) rather than as a caption read on every visit (CPY-01).
    expect(screen.getByRole('img', { name: 'Tổng hợp các công việc' }).parentElement).toHaveTextContent(/^Tiến độ sàn$/)
    expect(screen.queryByText(/^tổng hợp các công việc$/)).not.toBeInTheDocument()
  })

  it('explains the area on its label, and has no rules footer left under A3.1 (CPY-01)', async () => {
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    const identity = screen.getByTestId('deck-identity')
    const tip = within(identity).getByRole('img', { name: 'Mẫu số của mọi phần trăm trên sàn' })
    expect(tip.parentElement).toHaveTextContent(/^Diện tích sàn \(m²\)$/)
    // IDN-R4 and IDN-R5 were rationale, and with both gone the footer goes.
    expect(screen.queryByRole('button', { name: /Quy tắc áp dụng/ })).not.toBeInTheDocument()
  })

  it('has no subtitle and no summary while a deck is being created (CPY-01, CPY-03)', async () => {
    renderAt('/decks/new?project=p1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Sàn mới' })).toBeInTheDocument()
    expect(pageSubtitle()).toBeNull()
    expect(keyFactTexts()).toEqual([])
    expect(screen.queryByText(/Đặt tên, mã và diện tích trước/)).not.toBeInTheDocument()
    expect(screen.queryByText('Sàn chưa được tạo')).not.toBeInTheDocument()
  })

  it('reads the deck history once and hands it to both panels (Feedback Rv2, items 11 and 13)', async () => {
    renderAt('/decks/d1')
    expect(await screen.findByText('giờ công 2 lần')).toBeInTheDocument()
    expect(screen.getByText('dự báo d1')).toBeInTheDocument()
    expect(listDeckEvents).toHaveBeenCalledTimes(1)
    expect(listDeckEvents).toHaveBeenCalledWith('d1')
  })
})

describe('DeckDetailScreen: the quantity and unit of the deck\'s works (RV6-36)', () => {
  it('labels the header, the card, the form and the editor with the one work\'s quantity', async () => {
    listDeckWorks.mockResolvedValue([{ work: { ...WORK1, quantityLabel: 'Khối lượng', unit: 'tấn' }, weight: 1, stages: [] }])
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await waitFor(() => expect(headerFacts()).toEqual(['24 ô', '5.258,50 tấn']))
    expect(screen.getByText('Khối lượng sàn (tấn)')).toBeInTheDocument()
    expect(screen.getByText('editor MD xem Khối lượng/tấn')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Sửa'))
    expect(await screen.findByLabelText('Khối lượng sàn (tấn)')).toBeInTheDocument()
    expect(screen.queryByText(/m²/)).toBeNull()
  })

  it('reads Số lượng with no unit when the deck\'s works disagree', async () => {
    listDeckWorks.mockResolvedValue([
      { work: WORK1, weight: 1, stages: [] },
      { work: { ...WORK2, quantityLabel: 'Khối lượng', unit: 'tấn' }, weight: 1, stages: [] },
    ])
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await waitFor(() => expect(screen.getByText('Số lượng sàn')).toBeInTheDocument())
    expect(headerFacts()).toEqual(['24 ô', '5.258,50'])
    expect(screen.getByText('editor MD xem Số lượng/none')).toBeInTheDocument()
  })

  it('keeps Diện tích sàn (m²) for a deck in no work yet', async () => {
    listDeckWorks.mockResolvedValue([])
    renderAt('/decks/d1')
    await screen.findByRole('heading', { level: 1, name: 'Main Deck' })
    await waitFor(() => expect(screen.getByText('editor MD xem Diện tích/m²')).toBeInTheDocument())
    expect(screen.getByText('Diện tích sàn (m²)')).toBeInTheDocument()
    expect(headerFacts()).toEqual(['24 ô', '5.258,50 m²'])
  })
})
