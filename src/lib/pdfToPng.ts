import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// The worker ships as a build asset rather than a CDN fetch. Two reasons, and
// the second is the real one. First, a same-install file makes the worker and
// library versions match structurally instead of by interpolating a version
// string into a URL. Second, when a CDN fetch fails pdf.js retries the same URL
// on the main thread before rejecting, so the caller waits out two failed round
// trips and then gets "Setting up fake worker failed", which names neither the
// network nor the CDN -- on a firewalled or flaky link that is a slow, badly
// diagnosable failure instead of no failure at all.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * Render width in pixels. The drawing is the substrate the admin places guides
 * on, so it needs enough resolution that beam lines stay distinguishable when
 * zoomed; 2000px keeps a typical deck plan legible without producing a PNG too
 * large for the free Storage tier.
 */
export const PDF_RENDER_WIDTH = 2000

export interface RenderedPage {
  blob: Blob
  width: number
  height: number
}

GlobalWorkerOptions.workerSrc = workerSrc

/**
 * Loaded documents, keyed by the File the caller handed us. The page picker
 * calls pdfPageCount and then renderPdfPage on the same File, and without this
 * both re-read the bytes and re-parse the structure -- doubling worker spin-up
 * on a large drawing for no gain. A WeakMap so the document is collectable once
 * the caller drops the File.
 */
const loaded = new WeakMap<File, Promise<PDFDocumentProxy>>()

async function loadPdf(file: File): Promise<PDFDocumentProxy> {
  const cached = loaded.get(file)
  if (cached) return cached
  const pending = (async () => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return getDocument({ data: bytes }).promise
  })()
  loaded.set(file, pending)
  return pending
}

export async function pdfPageCount(file: File): Promise<number> {
  const pdf = await loadPdf(file)
  return pdf.numPages
}

export async function renderPdfPage(
  file: File,
  pageNumber: number,
): Promise<RenderedPage> {
  const pdf = await loadPdf(file)
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(`Cannot render page ${pageNumber} of ${pdf.numPages}`)
  }

  const page = await pdf.getPage(pageNumber)
  const unscaled = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: PDF_RENDER_WIDTH / unscaled.width })

  const { canvas, context } = createCanvas(Math.round(viewport.width), Math.round(viewport.height))
  // canvasContext is passed for backwards compatibility only: pdf.js ignores
  // it whenever canvas is also present and re-derives its own context from
  // the canvas instead, so this argument is inert, not load-bearing.
  await page.render({ canvas, canvasContext: context, viewport }).promise

  return {
    blob: await canvasToPng(canvas),
    width: canvas.width,
    height: canvas.height,
  }
}


function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not get a 2d canvas context')
  return { canvas, context }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the drawing as PNG'))
    }, 'image/png')
  })
}
