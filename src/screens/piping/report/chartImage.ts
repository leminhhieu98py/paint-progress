import { createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { CamPoint, CamSeriesKey } from '../../../domain/piping/cam'
import type { ManpowerPoint } from '../../../domain/piping/manpower'
import type { ReinstatementPoint } from '../../../domain/piping/reinstatement'
import type { ManpowerGroup, ViewMode } from '../../../domain/piping/types'
import type { ChartPng } from '../../../lib/piping/report'
import { ReinstatementChart } from '../charts'
import { InsulationChart } from '../insulation/InsulationChart'
import { ManpowerChart } from '../manpower/ManpowerChart'

/**
 * The report's chart pictures (spec §10, Q25A): the Piping page's own chart
 * components, rendered off screen at a fixed width, their Recharts SVG
 * serialised with the computed styles inlined, drawn on a canvas and read
 * back as a PNG. The same components as on screen, so the picture is the
 * chart the reader saw, not a second drawing of it.
 *
 * Recharts draws its legend in HTML beside the SVG: every SVG in the chart
 * (the plot and the legend's markers) is drawn at its own place, and the
 * legend's labels are written with the canvas's text. The charts render in
 * report mode, so the picture has the whole range and no Brush.
 *
 * Isolated here so the report and the export action are tested without a
 * canvas (jsdom has none); a failure rejects, and the caller writes
 * "Không vẽ được biểu đồ" instead of the picture.
 */

export type ChartSpec =
  | { kind: 'reinstatement'; data: ReinstatementPoint[]; mode: ViewMode }
  | { kind: 'manpower'; data: ManpowerPoint[]; groups: ManpowerGroup[]; mode: ViewMode }
  | { kind: 'insulation'; data: CamPoint[]; keys: CamSeriesKey[]; mode: ViewMode }

/** The chart's width on the canvas, in CSS pixels; its height is the component's own. */
export const CHART_WIDTH = 1000
/** Device pixels per CSS pixel: a sharp picture when Excel scales it. */
const SCALE = 2
/** How long one chart may take, laid out and drawn, before it counts as failed. */
export const CHART_TIMEOUT_MS = 15_000
/**
 * How often the layout is checked. Timers, not animation frames: a background
 * tab pauses frames but still runs timers (throttled), so the deadline holds.
 */
const POLL_MS = 50

/** The page's chart in report mode: the whole range, no Brush, the desktop layout. Exported for its test. */
export function chartElement(spec: ChartSpec): ReactElement {
  switch (spec.kind) {
    case 'reinstatement':
      return createElement(ReinstatementChart, { data: spec.data, mode: spec.mode, report: true })
    case 'manpower':
      return createElement(ManpowerChart, { data: spec.data, groups: spec.groups, mode: spec.mode, report: true })
    case 'insulation':
      return createElement(InsulationChart, { data: spec.data, keys: spec.keys, mode: spec.mode, report: true })
  }
}

/** The presentation properties a standalone SVG image needs inlined: it sees no stylesheet. */
const INLINED = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'visibility', 'display',
] as const

/**
 * One SVG of the chart as standalone markup: a deep copy with the computed
 * styles inlined, its size fixed to what it measures on screen. Exported for
 * its test.
 */
export function svgMarkup(svg: SVGSVGElement, size: { width: number; height: number }): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const originals = [svg, ...svg.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  originals.forEach((el, i) => {
    const computed = getComputedStyle(el)
    const style = INLINED
      .map((p) => [p, computed.getPropertyValue(p)] as const)
      .filter(([, v]) => v !== '')
      .map(([p, v]) => `${p}:${v}`)
      .join(';')
    if (style !== '') (copies[i] as Element).setAttribute('style', style)
  })
  // No xmlns attribute: the serialiser writes the SVG namespace of the element itself, and a second one is not XML.
  clone.setAttribute('width', String(size.width))
  clone.setAttribute('height', String(size.height))
  return new XMLSerializer().serializeToString(clone)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits until Recharts has drawn its plot at a real size, then two polls more; rejects past `deadline`. */
async function laidOut(host: HTMLElement, deadline: number): Promise<HTMLElement> {
  for (;;) {
    const surface = host.querySelector<SVGSVGElement>('svg.recharts-surface')
    if (surface && surface.getBoundingClientRect().width > 0) {
      await delay(POLL_MS)
      await delay(POLL_MS)
      const chart = host.firstElementChild
      if (!(chart instanceof HTMLElement)) throw new Error('chart not rendered')
      return chart
    }
    if (Date.now() > deadline) throw new Error('chart layout timed out')
    await delay(POLL_MS)
  }
}

/** The SVG markup as an image, or a rejection when it neither loads nor fails by `deadline`. Exported for its test. */
export function loadImage(markup: string, deadline: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(() => reject(new Error('chart image timed out')), Math.max(0, deadline - Date.now()))
    img.onload = () => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error('chart image failed to load'))
    }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })
}

/** Draws the rendered chart on a canvas: every SVG at its place, then the legend's labels. */
async function paint(chart: HTMLElement, deadline: number): Promise<ChartPng> {
  const box = chart.getBoundingClientRect()
  const width = Math.round(box.width)
  const height = Math.round(box.height)
  if (width === 0 || height === 0) throw new Error('chart has no size')
  const canvas = document.createElement('canvas')
  canvas.width = width * SCALE
  canvas.height = height * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  for (const svg of chart.querySelectorAll<SVGSVGElement>('svg')) {
    // A nested SVG is drawn with the one around it.
    if (svg.parentElement?.closest('svg')) continue
    const r = svg.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const img = await loadImage(svgMarkup(svg, { width: r.width, height: r.height }), deadline)
    ctx.drawImage(img, r.left - box.left, r.top - box.top, r.width, r.height)
  }

  for (const label of chart.querySelectorAll<HTMLElement>('.recharts-legend-item-text')) {
    const text = label.textContent ?? ''
    if (text === '') continue
    // The formatter's span carries the colour; the item's text node, the font.
    const styled = label.querySelector<HTMLElement>('span') ?? label
    const computed = getComputedStyle(styled)
    const r = styled.getBoundingClientRect()
    ctx.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`
    ctx.fillStyle = computed.color
    ctx.textBaseline = 'middle'
    ctx.fillText(text, r.left - box.left, r.top - box.top + r.height / 2, Math.max(1, box.right - r.left))
  }

  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (base64 === '') throw new Error('empty PNG')
  return { base64, width, height }
}

/**
 * The chart as a PNG, rendered off screen at `CHART_WIDTH` and removed
 * afterwards. Rejects when it cannot be drawn, or is not laid out and drawn
 * within `timeoutMs` (the caller then writes the chart as failed).
 */
export async function renderChartPng(
  spec: ChartSpec,
  { timeoutMs = CHART_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ChartPng> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed', left: '-20000px', top: '0', width: `${CHART_WIDTH}px`,
    pointerEvents: 'none', background: '#ffffff',
  })
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    root.render(chartElement(spec))
    const deadline = Date.now() + timeoutMs
    return await paint(await laidOut(host, deadline), deadline)
  } finally {
    root.unmount()
    host.remove()
  }
}
