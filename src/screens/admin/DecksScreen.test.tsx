import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DecksScreen } from './DecksScreen'

const listProjects = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())
const createDeck = vi.hoisted(() => vi.fn())
const uploadDrawing = vi.hoisted(() => vi.fn())
const pdfPageCount = vi.hoisted(() => vi.fn())
const renderPdfPage = vi.hoisted(() => vi.fn())
const imageFileToPng = vi.hoisted(() => vi.fn())

vi.mock('../../lib/projectsApi', () => ({ listProjects: () => listProjects() }))
vi.mock('../../lib/decksApi', () => ({
  listDecks: (p: string) => listDecks(p),
  createDeck: (i: unknown) => createDeck(i),
  uploadDrawing: (a: string, b: string, c: Blob, d: number, e: number) => uploadDrawing(a, b, c, d, e),
}))
vi.mock('../../lib/pdfToPng', () => ({
  pdfPageCount: (f: File) => pdfPageCount(f),
  renderPdfPage: (f: File, n: number) => renderPdfPage(f, n),
  imageFileToPng: (f: File) => imageFileToPng(f),
  PDF_RENDER_WIDTH: 2000,
}))
// The mock echoes the deck it was handed, so a test can prove the editor opened
// on the row that was clicked. A bare <div>editor</div> would pass even if the
// screen passed the wrong deck, or the same deck every time.
vi.mock('./DeckEditor', () => ({
  DeckEditor: ({ deck }: { deck: { code: string } }) => <div>editor {deck.code}</div>,
}))

beforeEach(() => {
  for (const m of [listProjects, listDecks, createDeck, uploadDrawing, pdfPageCount, renderPdfPage, imageFileToPng]) m.mockReset()
  listProjects.mockResolvedValue([{ id: 'p1', name: 'BB1', code: 'BB1', deckCount: 1, totalAreaM2: 0, progress: 0 }])
  listDecks.mockResolvedValue([
    { id: 'd1', projectId: 'p1', seq: 1, name: 'Main Deck', code: 'MD', imagePath: null, imageW: null, imageH: null, totalAreaM2: 5258.5, areaSource: 'guides', cellCount: 24 },
  ])
})

describe('DecksScreen', () => {
  it('lists the decks of the first project', async () => {
    render(<DecksScreen />)
    expect(await screen.findByText('Main Deck')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
  })

  it('shows a page picker for a multi-page PDF and uploads the chosen page', async () => {
    pdfPageCount.mockResolvedValue(3)
    renderPdfPage.mockResolvedValue({ blob: new Blob(['x']), width: 2000, height: 1600 })
    uploadDrawing.mockResolvedValue('p1/d1.png')
    render(<DecksScreen />)
    await screen.findByText('Main Deck')

    const file = new File([new Uint8Array([1])], 'deck.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByTestId('drawing-input-d1'), file)

    expect(await screen.findByText(/3 trang/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Trang'))
    await userEvent.type(screen.getByLabelText('Trang'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Nhập bản vẽ' }))

    await waitFor(() => expect(renderPdfPage).toHaveBeenCalledWith(file, 2))
    expect(uploadDrawing).toHaveBeenCalledWith('d1', 'p1', expect.anything(), 2000, 1600)
  })

  it('surfaces an import failure', async () => {
    pdfPageCount.mockRejectedValue(new Error('Invalid PDF structure'))
    render(<DecksScreen />)
    await screen.findByText('Main Deck')
    await userEvent.upload(
      screen.getByTestId('drawing-input-d1'),
      new File([new Uint8Array([1])], 'bad.pdf', { type: 'application/pdf' }),
    )
    expect(await screen.findByText(/Invalid PDF structure/)).toBeInTheDocument()
  })

  it('imports a single-page PDF directly, with no page picker', async () => {
    // `pageCount > 1`, not `>= 1`: a one-page drawing has nothing to choose, so
    // asking would be a modal the admin has to dismiss on every single import.
    pdfPageCount.mockResolvedValue(1)
    renderPdfPage.mockResolvedValue({ blob: new Blob(['x']), width: 2000, height: 1600 })
    uploadDrawing.mockResolvedValue('p1/d1.png')
    render(<DecksScreen />)
    await screen.findByText('Main Deck')

    const file = new File([new Uint8Array([1])], 'deck.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByTestId('drawing-input-d1'), file)

    await waitFor(() => expect(renderPdfPage).toHaveBeenCalledWith(file, 1))
    expect(screen.queryByText('Chọn trang bản vẽ')).toBeNull()
    expect(uploadDrawing).toHaveBeenCalledWith('d1', 'p1', expect.anything(), 2000, 1600)
  })

  it('sends an image through the image converter, not the PDF renderer', async () => {
    // Inverting the `file.type === 'application/pdf'` test would push a PNG
    // into pdf.js, which fails with "Invalid PDF structure" -- a message that
    // blames the file the admin just picked rather than the code.
    imageFileToPng.mockResolvedValue({ blob: new Blob(['x']), width: 1600, height: 1200 })
    uploadDrawing.mockResolvedValue('p1/d1.png')
    render(<DecksScreen />)
    await screen.findByText('Main Deck')

    const file = new File([new Uint8Array([1])], 'deck.png', { type: 'image/png' })
    await userEvent.upload(screen.getByTestId('drawing-input-d1'), file)

    await waitFor(() => expect(imageFileToPng).toHaveBeenCalledWith(file))
    expect(pdfPageCount).not.toHaveBeenCalled()
    expect(renderPdfPage).not.toHaveBeenCalled()
    expect(uploadDrawing).toHaveBeenCalledWith('d1', 'p1', expect.anything(), 1600, 1200)
  })

  it('creates a deck and refreshes the list', async () => {
    createDeck.mockResolvedValue('d2')
    render(<DecksScreen />)
    await screen.findByText('Main Deck')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))
    await userEvent.type(screen.getByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo' }))
    // The whole payload: `toHaveBeenCalled()` alone passes even with name and
    // code swapped, which is a mistake nothing downstream would catch.
    await waitFor(() =>
      expect(createDeck).toHaveBeenCalledWith({
        projectId: 'p1', seq: 2, name: 'Cellar Deck', code: 'CD',
      }),
    )
    expect(listDecks).toHaveBeenCalledTimes(2)
  })

  it('opens the editor on the deck whose row was clicked', async () => {
    // The only entry point to the entire deck editor.
    listDecks.mockResolvedValue([
      { id: 'd1', projectId: 'p1', seq: 1, name: 'Main Deck', code: 'MD', imagePath: null, imageW: null, imageH: null, totalAreaM2: 5258.5, areaSource: 'guides', cellCount: 24 },
      { id: 'd2', projectId: 'p1', seq: 2, name: 'Cellar Deck', code: 'CD', imagePath: null, imageW: null, imageH: null, totalAreaM2: 900, areaSource: 'prorated', cellCount: 8 },
    ])
    render(<DecksScreen />)
    await screen.findByText('Cellar Deck')

    await userEvent.click(screen.getAllByRole('button', { name: 'Mở' })[1])

    expect(await screen.findByText('editor CD')).toBeInTheDocument()
    // The list is replaced by the editor, not stacked underneath it.
    expect(screen.queryByText('Main Deck')).toBeNull()
  })

  it('shows an empty state, not a spinner, when there is no project at all', async () => {
    // `loading` initialises true and refreshDecks returns early with no
    // project, so anything that fails to clear it leaves the table spinning
    // with no empty state and no error -- indistinguishable from a hung query.
    listProjects.mockResolvedValue([])
    render(<DecksScreen />)

    await waitFor(() => expect(document.querySelector('.ant-spin-spinning')).toBeNull())
    // Scoped to the description: antd's empty-state illustration carries an
    // SVG <title> with the same text, so an unscoped query is ambiguous. The
    // wording is antd's default locale, not this screen's copy -- these tests
    // render without the app's viVN ConfigProvider.
    expect(
      await screen.findByText('No data', { selector: '.ant-empty-description' }),
    ).toBeInTheDocument()
    expect(listDecks).not.toHaveBeenCalled()
  })
})
