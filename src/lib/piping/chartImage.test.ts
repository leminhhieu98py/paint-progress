import { afterEach, describe, expect, it } from 'vitest'
import { renderChartPng, svgMarkup } from './chartImage'

/**
 * jsdom lays nothing out and has no canvas: what is checked here is the SVG
 * serialisation and that a render that cannot complete rejects and leaves
 * nothing behind. The picture itself is checked in the browser.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('svgMarkup', () => {
  it('inlines the computed styles, fixes the size and leaves the Brush out', () => {
    const style = document.createElement('style')
    style.textContent = '.bar { fill: rgb(1, 2, 3); } text { font-family: Inter; }'
    document.head.appendChild(style)
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'recharts-surface')
    const bar = document.createElementNS(SVG_NS, 'rect')
    bar.setAttribute('class', 'bar')
    const label = document.createElementNS(SVG_NS, 'text')
    label.textContent = '01/10'
    const brush = document.createElementNS(SVG_NS, 'g')
    brush.setAttribute('class', 'recharts-layer recharts-brush')
    brush.appendChild(document.createElementNS(SVG_NS, 'rect'))
    svg.append(bar, label, brush)
    document.body.appendChild(svg)

    const markup = svgMarkup(svg, { width: 1000, height: 380 })
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const root = doc.documentElement
    expect(markup.startsWith(`<svg xmlns="${SVG_NS}"`)).toBe(true)
    expect(root.namespaceURI).toBe(SVG_NS)
    expect(root.getAttribute('width')).toBe('1000')
    expect(root.getAttribute('height')).toBe('380')
    expect(root.querySelector('.recharts-brush')).toBeNull()
    expect(root.querySelector('.bar')?.getAttribute('style')).toContain('fill:rgb(1, 2, 3)')
    expect(root.querySelector('text')?.getAttribute('style')).toContain('font-family:Inter')
    // The page's own SVG is untouched.
    expect(svg.querySelector('.recharts-brush')).not.toBeNull()
    expect(bar.getAttribute('style')).toBeNull()
  })
})

describe('renderChartPng', () => {
  it('rejects when the chart never lays out, and removes its off-screen host', async () => {
    await expect(renderChartPng({ kind: 'reinstatement', data: [], mode: 'day' }, { timeoutMs: 30 })).rejects.toThrow()
    expect(document.body.children).toHaveLength(0)
  })
})
