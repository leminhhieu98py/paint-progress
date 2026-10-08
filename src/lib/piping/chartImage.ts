import { createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { CamPoint, CamSeriesKey } from '../../domain/piping/cam'
import type { ManpowerPoint } from '../../domain/piping/manpower'
import type { ReinstatementPoint } from '../../domain/piping/reinstatement'
import type { ManpowerGroup, ViewMode } from '../../domain/piping/types'
import { ReinstatementChart } from '../../screens/piping/charts'
import { InsulationChart } from '../../screens/piping/insulation/InsulationChart'
import { ManpowerChart } from '../../screens/piping/manpower/ManpowerChart'
import type { ChartPng } from './report'

/**
 * The report's chart pictures (spec §10, Q25A): the Piping page's own chart
 * components, rendered off screen at a fixed width, their Recharts SVG
 * serialised with the computed styles inlined, drawn on a canvas and read
 * back as a PNG. The same components as on screen, so the picture is the
 * chart the reader saw, not a second drawing of it.
 *
 * Recharts draws its legend in HTML beside the SVG: every SVG in the chart
 * (the plot and the legend's markers) is drawn at its own place, and the
 * legend's labels are written with the canvas's text. The Brush, a control,
 * is left out of the picture.
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
/** How long the chart may take to lay out before the render counts as failed. */
const LAYOUT_TIMEOUT_MS = 3000

function chartElement(spec: ChartSpec): ReactElement {
  switch (spec.kind) {
    case 'reinstatement':
      return createElement(ReinstatementChart, { data: spec.data, mode: spec.mode })
    case 'manpower':
      return createElement(ManpowerChart, { data: spec.data, groups: spec.groups, mode: spec.mode })
    case 'insulation':
      return createElement(InsulationChart, { data: spec.data, keys: spec.keys, mode: spec.mode })
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
 * styles inlined, its size fixed to what it measures on screen, the Brush
 * removed. Exported for its test.
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
  for (const brush of clone.querySelectorAll('.recharts-brush')) brush.remove()
  // No xmlns attribute: the serialiser writes the SVG namespace of the element itself, and a second one is not XML.
  clone.setAttribute('width', String(size.width))
  clone.setAttribute('height', String(size.height))
  return new XMLSerializer().serializeToString(clone)
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/** Waits until Recharts has drawn its plot at a real size, then two frames more. */
async function laidOut(host: HTMLElement, timeoutMs: number): Promise<HTMLElement> {
  const started = Date.now()
  for (;;) {
    const surface = host.querySelector<SVGSVGElement>('svg.recharts-surface')
    if (surface && surface.getBoundingClientRect().width > 0) {
      await nextFrame()
      await nextFrame()
      const chart = host.firstElementChild
      if (!(chart instanceof HTMLElement)) throw new Error('chart not rendered')
      return chart
    }
    if (Date.now() - started > timeoutMs) throw new Error('chart layout timed out')
    await nextFrame()
  }
}

function loadImage(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('chart image failed to load'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })
}

/** Draws the rendered chart on a canvas: every SVG at its place, then the legend's labels. */
async function paint(chart: HTMLElement): Promise<ChartPng> {
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
    const img = await loadImage(svgMarkup(svg, { width: r.width, height: r.height }))
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
 * afterwards. Rejects when it cannot be drawn, or has not laid out within
 * `timeoutMs`.
 */
export async function renderChartPng(
  spec: ChartSpec,
  { timeoutMs = LAYOUT_TIMEOUT_MS }: { timeoutMs?: number } = {},
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
    return await paint(await laidOut(host, timeoutMs))
  } finally {
    root.unmount()
    host.remove()
  }
}
