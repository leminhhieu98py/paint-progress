import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist'

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

// pdf.js needs a worker. Sourcing it from the same CDN version as the installed
// package avoids a version-mismatch error that presents as a blank canvas.
GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`

async function loadPdf(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return getDocument({ data: bytes }).promise
}

export async function pdfPageCount(file: File): Promise<number> {
  const pdf = await loadPdf(file)
  return pdf.numPages
}

export async function renderPdfPage(
  file: File,
  pageNumber: number,
  targetWidth: number = PDF_RENDER_WIDTH,
): Promise<RenderedPage> {
  const pdf = await loadPdf(file)
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(`Cannot render page ${pageNumber} of ${pdf.numPages}`)
  }

  const page = await pdf.getPage(pageNumber)
  const unscaled = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: targetWidth / unscaled.width })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not get a 2d canvas context')

  await page.render({ canvas, canvasContext: context, viewport }).promise

  return {
    blob: await canvasToPng(canvas),
    width: canvas.width,
    height: canvas.height,
  }
}

/** An uploaded PNG/JPG is normalised to PNG so the editor has one format. */
export async function imageFileToPng(file: File): Promise<RenderedPage> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not get a 2d canvas context')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { blob: await canvasToPng(canvas), width: canvas.width, height: canvas.height }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the drawing as PNG'))
    }, 'image/png')
  })
}
