import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDF_RENDER_WIDTH, pdfPageCount, renderPdfPage } from './pdfToPng'

const getDocument = vi.hoisted(() => vi.fn())
vi.mock('pdfjs-dist', () => ({
  getDocument,
  GlobalWorkerOptions: { workerSrc: '' },
}))
// pdfToPng.ts imports the pdf.js worker as a Vite `?url` asset. This is a
// stub URL string standing in for the hashed asset path Vite would produce --
// it is never fetched under jsdom, so its value is arbitrary and only exists
// to satisfy the import.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'stub-worker-url' }))

function pdfStub(pages: number, viewport = { width: 800, height: 600 }) {
  // The page object is a stable reference (not recreated per getPage() call)
  // so tests can assert on its getViewport mock after renderPdfPage runs.
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: viewport.width * scale,
      height: viewport.height * scale,
      scale,
    })),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
  }
  return {
    page,
    promise: Promise.resolve({
      numPages: pages,
      getPage: vi.fn(async () => page),
    }),
  }
}

beforeEach(() => getDocument.mockReset())

describe('pdfPageCount', () => {
  it('returns the page count', async () => {
    getDocument.mockReturnValue(pdfStub(7))
    const file = new File([new Uint8Array([1, 2, 3])], 'deck.pdf', { type: 'application/pdf' })
    await expect(pdfPageCount(file)).resolves.toBe(7)
  })
})

describe('renderPdfPage', () => {
  it('rejects a page number outside the document', async () => {
    getDocument.mockReturnValue(pdfStub(2))
    const file = new File([new Uint8Array([1])], 'deck.pdf', { type: 'application/pdf' })
    await expect(renderPdfPage(file, 3)).rejects.toThrow(/page 3 of 2/)
    await expect(renderPdfPage(file, 0)).rejects.toThrow(/page 0 of 2/)
  })

  it('exposes the default render width', () => {
    // Wide enough that a 1:100 deck plan's beam lines stay distinguishable
    // when the admin zooms in to place guides.
    expect(PDF_RENDER_WIDTH).toBe(2000)
  })

  it('accepts the first and last page numbers', async () => {
    getDocument.mockReturnValue(pdfStub(2))
    const file = new File([new Uint8Array([1])], 'deck.pdf', { type: 'application/pdf' })
    // jsdom has no 2d canvas context, so even a page number the guard
    // accepts still fails -- but only past the guard, with a different
    // error. That distinct error is what proves the guard let it through
    // instead of rejecting it as out of range.
    await expect(renderPdfPage(file, 1)).rejects.toThrow(/2d canvas context/)
    await expect(renderPdfPage(file, 2)).rejects.toThrow(/2d canvas context/)
  })
})

describe('renderPdfPage viewport scale', () => {
  it('scales the viewport so its width matches PDF_RENDER_WIDTH by default', async () => {
    const stub = pdfStub(1, { width: 800, height: 600 })
    getDocument.mockReturnValue(stub)
    const file = new File([new Uint8Array([1])], 'deck.pdf', { type: 'application/pdf' })

    await expect(renderPdfPage(file, 1)).rejects.toThrow(/2d canvas context/)

    // First call measures the page at its native size; second call requests
    // the scale that stretches that native width to the target width.
    expect(stub.page.getViewport).toHaveBeenNthCalledWith(1, { scale: 1 })
    expect(stub.page.getViewport).toHaveBeenNthCalledWith(2, { scale: PDF_RENDER_WIDTH / 800 })
  })

  it('scales the viewport proportionally to a caller-supplied target width', async () => {
    const stub = pdfStub(1, { width: 800, height: 600 })
    getDocument.mockReturnValue(stub)
    const file = new File([new Uint8Array([1])], 'deck.pdf', { type: 'application/pdf' })

    await expect(renderPdfPage(file, 1, 500)).rejects.toThrow(/2d canvas context/)

    expect(stub.page.getViewport).toHaveBeenNthCalledWith(1, { scale: 1 })
    expect(stub.page.getViewport).toHaveBeenNthCalledWith(2, { scale: 500 / 800 })
  })
})

describe('loadPdf caching', () => {
  it('loads the document once for pdfPageCount followed by renderPdfPage on the same File', async () => {
    getDocument.mockReturnValue(pdfStub(2))
    const file = new File([new Uint8Array([1])], 'deck.pdf', { type: 'application/pdf' })

    await expect(pdfPageCount(file)).resolves.toBe(2)
    // jsdom has no 2d canvas context, so this still rejects -- but only after
    // reusing the cached document, which is what this test checks.
    await expect(renderPdfPage(file, 1)).rejects.toThrow(/2d canvas context/)

    expect(getDocument).toHaveBeenCalledTimes(1)
  })

  it('loads the document separately for two different Files', async () => {
    getDocument.mockReturnValue(pdfStub(2))
    const fileA = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' })
    const fileB = new File([new Uint8Array([2])], 'b.pdf', { type: 'application/pdf' })

    await expect(pdfPageCount(fileA)).resolves.toBe(2)
    await expect(pdfPageCount(fileB)).resolves.toBe(2)

    // A cache keyed on the wrong thing (e.g. ignoring the File entirely)
    // would also make the single-File test above pass, so both assertions
    // are needed together to pin the cache key down to the File itself.
    expect(getDocument).toHaveBeenCalledTimes(2)
  })
})
