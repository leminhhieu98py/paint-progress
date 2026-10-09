import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHART_TIMEOUT_MS, chartElement, loadImage, pictureFontFamily, renderChartPng, svgMarkup } from './chartImage'

/**
 * jsdom lays nothing out and has no canvas: what is checked here is the SVG
 * serialisation and that a render that cannot complete rejects and leaves
 * nothing behind. The picture itself is checked in the browser.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

afterEach(() => {
  vi.unstubAllGlobals()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('svgMarkup', () => {
  it('inlines the computed styles and fixes the size', () => {
    const style = document.createElement('style')
    style.textContent = '.bar { fill: rgb(1, 2, 3); } text { font-family: Inter; }'
    document.head.appendChild(style)
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'recharts-surface')
    const bar = document.createElementNS(SVG_NS, 'rect')
    bar.setAttribute('class', 'bar')
    const label = document.createElementNS(SVG_NS, 'text')
    label.textContent = '01/10'
    svg.append(bar, label)
    document.body.appendChild(svg)

    const markup = svgMarkup(svg, { width: 1000, height: 380 })
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const root = doc.documentElement
    expect(markup.startsWith(`<svg xmlns="${SVG_NS}"`)).toBe(true)
    expect(root.namespaceURI).toBe(SVG_NS)
    expect(root.getAttribute('width')).toBe('1000')
    expect(root.getAttribute('height')).toBe('380')
    expect(root.querySelector('.bar')?.getAttribute('style')).toContain('fill:rgb(1, 2, 3)')
    expect(root.querySelector('text')?.getAttribute('style')).toContain('font-family:Inter')
    // The page's own SVG is untouched.
    expect(bar.getAttribute('style')).toBeNull()
  })
})

describe('the picture\'s one font', () => {
  it('drops the app\'s web font, which an SVG drawn as an image cannot load, keeping the system stack', () => {
    expect(pictureFontFamily('"Be Vietnam Pro", -apple-system, BlinkMacSystemFont, Arial, sans-serif'))
      .toBe('-apple-system, BlinkMacSystemFont, Arial, sans-serif')
    expect(pictureFontFamily("'Be Vietnam Pro', Arial")).toBe('Arial')
    expect(pictureFontFamily('Inter')).toBe('Inter')
    expect(pictureFontFamily('"Be Vietnam Pro"')).toBe('sans-serif')
  })

  it('writes the axis text in that same system stack', () => {
    const style = document.createElement('style')
    style.textContent = 'text { font-family: "Be Vietnam Pro", Arial, sans-serif; }'
    document.head.appendChild(style)
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.appendChild(document.createElementNS(SVG_NS, 'text'))
    document.body.appendChild(svg)
    const doc = new DOMParser().parseFromString(svgMarkup(svg, { width: 10, height: 10 }), 'image/svg+xml')
    const inlined = doc.documentElement.querySelector('text')?.getAttribute('style') ?? ''
    expect(inlined).toContain('font-family:Arial, sans-serif')
    expect(inlined).not.toContain('Vietnam')
  })
})

describe('chartElement', () => {
  it('draws each chart in report mode: the whole range, no Brush, the desktop layout', () => {
    expect(chartElement({ kind: 'reinstatement', data: [], mode: 'day' }).props).toMatchObject({ report: true, mode: 'day' })
    expect(chartElement({ kind: 'manpower', data: [], groups: [], mode: 'week' }).props).toMatchObject({ report: true, mode: 'week' })
    expect(chartElement({ kind: 'insulation', data: [], keys: ['phActual'], mode: 'day' }).props)
      .toMatchObject({ report: true, keys: ['phActual'] })
  })
})

describe('renderChartPng', () => {
  it('rejects when the chart never lays out, and removes its off-screen host', async () => {
    await expect(renderChartPng({ kind: 'reinstatement', data: [], mode: 'day' }, { timeoutMs: 30 })).rejects.toThrow()
    expect(document.body.children).toHaveLength(0)
  })

  it('still gives up in time with no animation frames, as in a background tab', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    await expect(renderChartPng({ kind: 'reinstatement', data: [], mode: 'day' }, { timeoutMs: 30 }))
      .rejects.toThrow(/timed out/)
    expect(document.body.children).toHaveLength(0)
  })

  it('allows each chart 15 s in all', () => {
    expect(CHART_TIMEOUT_MS).toBe(15_000)
  })
})

describe('loadImage', () => {
  it('rejects when the picture neither loads nor fails within its time', async () => {
    // jsdom loads no image: neither onload nor onerror ever fires.
    await expect(loadImage('<svg xmlns="http://www.w3.org/2000/svg"/>', Date.now() + 30)).rejects.toThrow(/timed out/)
  })
})
