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

vi.mock('../../lib/projectsApi', () => ({ listProjects: () => listProjects() }))
vi.mock('../../lib/decksApi', () => ({
  listDecks: (p: string) => listDecks(p),
  createDeck: (i: unknown) => createDeck(i),
  uploadDrawing: (a: string, b: string, c: Blob, d: number, e: number) => uploadDrawing(a, b, c, d, e),
}))
vi.mock('../../lib/pdfToPng', () => ({
  pdfPageCount: (f: File) => pdfPageCount(f),
  renderPdfPage: (f: File, n: number) => renderPdfPage(f, n),
  imageFileToPng: vi.fn(),
  PDF_RENDER_WIDTH: 2000,
}))
vi.mock('./DeckEditor', () => ({ DeckEditor: () => <div>editor</div> }))

beforeEach(() => {
  for (const m of [listProjects, listDecks, createDeck, uploadDrawing, pdfPageCount, renderPdfPage]) m.mockReset()
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

  it('creates a deck and refreshes the list', async () => {
    createDeck.mockResolvedValue('d2')
    render(<DecksScreen />)
    await screen.findByText('Main Deck')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo sàn' }))
    await userEvent.type(screen.getByLabelText('Tên sàn'), 'Cellar Deck')
    await userEvent.type(screen.getByLabelText('Mã sàn'), 'CD')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo' }))
    await waitFor(() => expect(createDeck).toHaveBeenCalled())
    expect(listDecks).toHaveBeenCalledTimes(2)
  })
})
