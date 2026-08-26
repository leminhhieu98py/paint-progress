import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeckDetailScreen } from './DeckDetailScreen'

const getDeck = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())
const createDeck = vi.hoisted(() => vi.fn())
const updateDeckIdentity = vi.hoisted(() => vi.fn())
const updateDeckArea = vi.hoisted(() => vi.fn())
const uploadDrawing = vi.hoisted(() => vi.fn())
const pdfPageCount = vi.hoisted(() => vi.fn())
const renderPdfPage = vi.hoisted(() => vi.fn())

vi.mock('../../lib/decksApi', () => ({
  getDeck: (id: string) => getDeck(id),
  listDecks: (p: string) => listDecks(p),
  createDeck: (i: unknown) => createDeck(i),
  updateDeckIdentity: (a: string, b: string, c: string) => updateDeckIdentity(a, b, c),
  updateDeckArea: (a: string, b: number, c: string) => updateDeckArea(a, b, c),
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
  DeckEditor: ({ deck }: { deck: { code: string } }) => <div>editor {deck.code}</div>,
}))

const DECK = {
  id: 'd1', projectId: 'p1', seq: 1, name: 'Main Deck', code: 'MD',
  imagePath: 'p1/d1.png', imageW: 2000, imageH: 1414,
  drawingName: 'ban-ve.pdf', drawingPage: null,
  totalAreaM2: 5258.5, areaSource: 'prorated' as const, cellCount: 24,
}

beforeEach(() => {
  for (const m of [getDeck, listDecks, createDeck, updateDeckIdentity, updateDeckArea, uploadDrawing, pdfPageCount, renderPdfPage]) {
    m.mockReset()
  }
  getDeck.mockResolvedValue(DECK)
  listDecks.mockResolvedValue([DECK])
  createDeck.mockResolvedValue('d9')
  updateDeckIdentity.mockResolvedValue(undefined)
  updateDeckArea.mockResolvedValue(undefined)
  uploadDrawing.mockResolvedValue(undefined)
  pdfPageCount.mockResolvedValue(1)
  renderPdfPage.mockResolvedValue({ blob: new Blob(['x']), width: 2000, height: 1414 })
})

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/decks" element={<div>deck list</div>} />
        <Route path="/decks/:deckId" element={<DeckDetailScreen />} />
      </Routes>
    </MemoryRouter>,
  )

const pdfFile = () => new File(['%PDF-1.4'], 'deck.pdf', { type: 'application/pdf' })

describe('DeckDetailScreen', () => {
  it('opens the deck named in the URL, so a reload keeps it', async () => {
    renderAt('/decks/d1')

    expect(await screen.findByText('Main Deck (MD)')).toBeInTheDocument()
    expect(getDeck).toHaveBeenCalledWith('d1')
  })

  it('shows the deck read-only until the admin asks to edit', async () => {
    // Curating a deck is destructive work -- detection replaces every cell --
    // and the screen a link lands on should not be one keystroke away from it.
    renderAt('/decks/d1')
    await screen.findByText('Main Deck (MD)')

    expect(screen.queryByLabelText('Bản vẽ (PDF)')).not.toBeInTheDocument()
    expect(screen.queryByText('editor MD')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sửa' }))

    expect(await screen.findByLabelText('Bản vẽ (PDF)')).toBeInTheDocument()
    expect(screen.getByText('editor MD')).toBeInTheDocument()
  })

  it('names the file the drawing came from', async () => {
    // The stored image is a render named from ids, so "Đã có" was the whole of
    // what the admin got back. On a project whose sheets are all called things
    // like 00171-14, that is not a small thing to be unsure about.
    renderAt('/decks/d1')

    expect(await screen.findByText('ban-ve.pdf')).toBeInTheDocument()
  })

  it('says which page of a multi-page file was taken', async () => {
    getDeck.mockResolvedValue({ ...DECK, drawingName: 'ban-ve.pdf', drawingPage: 3 })
    renderAt('/decks/d1')

    expect(await screen.findByText('ban-ve.pdf (trang 3)')).toBeInTheDocument()
  })

  it('admits it does not know, on a deck whose drawing predates recording it', async () => {
    // Every deck that already had a drawing has one whose origin nobody
    // recorded. Inventing a name would be worse than saying so.
    getDeck.mockResolvedValue({ ...DECK, drawingName: null, drawingPage: null })
    renderAt('/decks/d1')

    expect(await screen.findByText('Đã có (không rõ tên tệp)')).toBeInTheDocument()
  })

  it('shows what is on the deck now, above the picker that would replace it', async () => {
    // Choosing a file is destructive on a deck that already has one.
    renderAt('/decks/d1')
    await screen.findByText('Main Deck (MD)')
    await userEvent.click(screen.getByRole('button', { name: 'Sửa' }))

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
    await screen.findByText('Main Deck (MD)')
    await userEvent.click(screen.getByRole('button', { name: 'Sửa' }))

    expect(await screen.findByLabelText('Bản vẽ (PDF)')).toHaveAttribute('accept', 'application/pdf')
  })

  it('writes the name, the code and the area together', async () => {
    renderAt('/decks/d1')
    await screen.findByText('Main Deck (MD)')
    await userEvent.click(screen.getByRole('button', { name: 'Sửa' }))

    const name = await screen.findByLabelText('Tên sàn')
    await userEvent.clear(name)
    await userEvent.type(name, 'Cellar Deck')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sàn' }))

    await waitFor(() => expect(updateDeckIdentity).toHaveBeenCalledWith('d1', 'Cellar Deck', 'MD'))
    expect(updateDeckArea).toHaveBeenCalledWith('d1', 5258.5, 'prorated')
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
