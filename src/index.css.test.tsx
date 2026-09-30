import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { Alert, ConfigProvider, Modal, Table } from 'antd'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tablePagination } from './components/tablePagination'
import { adminTheme, fieldTheme } from './theme'

// Read from disk: vitest hands a stylesheet import back empty, `?raw` included.
// Beside this file, not under the working directory, so a runner started
// elsewhere (an IDE, a workspace root) finds it too. Not `new URL(...,
// import.meta.url)`: Vite rewrites that pattern into a served asset URL.
const css = readFileSync(resolve(import.meta.dirname, 'index.css'), 'utf8')

/**
 * The table rules that live in the stylesheet rather than on a column (UI-03,
 * UI-05). Vitest does not apply `index.css` on its own, so it is mounted here
 * as the app mounts it: one sheet over the whole document.
 */
let sheet: HTMLStyleElement

beforeEach(() => {
  sheet = document.createElement('style')
  sheet.textContent = css
  document.head.appendChild(sheet)
})

afterEach(() => sheet.remove())

const ROWS = [{ key: 'a', name: 'Sàn A' }]
const COLUMNS = [{ title: 'Sàn', dataIndex: 'name' }]
/**
 * A row that hands its cells `top`: the UA sheet makes a cell inherit its
 * row's alignment, so only the app's own rule can bring the cell back to the
 * middle -- which is what separates "stated" from "left to the default".
 */
const topRow = () => ({ style: { verticalAlign: 'top' } })

describe('index.css table rules', () => {
  it('centres every table cell vertically outside a card (UI-03)', () => {
    render(<Table dataSource={ROWS} columns={COLUMNS} pagination={false} onRow={topRow} />)
    expect(getComputedStyle(screen.getByText('Sàn A').closest('td')!).verticalAlign).toBe('middle')
  })

  it('centres every table cell vertically inside a modal (UI-03)', async () => {
    render(
      <Modal open title="Thử">
        <Table dataSource={ROWS} columns={COLUMNS} pagination={false} onRow={topRow} />
      </Modal>,
    )
    const cell = (await screen.findByText('Sàn A')).closest('td')!
    expect(getComputedStyle(cell).verticalAlign).toBe('middle')
  })

  it('sets a card table\'s pager in by the card inset (UI-05)', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ key: String(i), name: `Sàn ${i}` }))
    render(
      <div className="pp-card">
        <Table dataSource={rows} columns={COLUMNS} pagination={tablePagination(rows.length)} />
      </div>,
    )
    const pager = document.querySelector('.ant-table-pagination') as HTMLElement
    expect(pager).toHaveClass('ant-pagination-end')
    // jsdom does not resolve a logical margin against antd's physical one, so
    // this asks the sheet which rule reaches the pager rather than reading a
    // computed margin that jsdom never works out.
    const inset = Array.from(sheet.sheet!.cssRules)
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .find((r) => pager.matches(r.selectorText) && /margin-inline:\s*20px/.test(r.cssText))
    expect(inset).toBeDefined()
  })
})

describe('index.css colour swatch (CLR-01)', () => {
  const rule = (selector: string) =>
    Array.from(sheet.sheet!.cssRules)
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .find((r) => r.selectorText.split(',').map((s) => s.trim()).includes(selector))

  // jsdom drops rules on vendor pseudo-elements it does not know, so those
  // are read off the source text rather than the parsed sheet.
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    expect(at).toBeGreaterThanOrEqual(0)
    return css.slice(at, css.indexOf('}', at))
  }

  it('takes the native swatch\'s frame away and rounds what is left', () => {
    expect(block('.pp-swatch::-webkit-color-swatch-wrapper')).toMatch(/padding:\s*0/)
    for (const sel of ['.pp-swatch::-webkit-color-swatch', '.pp-swatch::-moz-color-swatch']) {
      expect(block(sel)).toMatch(/border:\s*none/)
      expect(block(sel)).toMatch(/border-radius:\s*50%/)
    }
  })

  it('rings the circle on keyboard focus only, outside it', () => {
    const ring = rule('.pp-swatch:focus-visible')
    expect(ring).toBeDefined()
    expect(ring!.style.outline).toMatch(/2px solid/)
    expect(ring!.style.outlineOffset).toBe('2px')
  })

  it('moves the focus ring outside a picked swatch\'s selection ring (S3)', () => {
    // The pick is a 2px gap then a 2px ring (0 0 0 2px, 0 0 0 4px): the focus
    // ring at offset 2 painted over that band, and a focused pick read as a
    // focused unpicked colour.
    const picked = rule('.pp-swatch[aria-checked="true"]:focus-visible')
    expect(picked).toBeDefined()
    expect(parseFloat(picked!.style.outlineOffset)).toBeGreaterThanOrEqual(6)
  })
})

describe('index.css Select popup on a phone (M6b)', () => {
  it('spans the screen less 16 px a side under 768 px, over the inline position rc-trigger sets', () => {
    const media = Array.from(sheet.sheet!.cssRules)
      .filter((r): r is CSSMediaRule => r instanceof CSSMediaRule)
      .find((r) => /max-width:\s*767\.98px/.test(r.conditionText))
    expect(media).toBeDefined()
    const rule = Array.from(media!.cssRules)
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .find((r) => r.selectorText.includes('.pp-select-popup'))
    expect(rule).toBeDefined()
    const s = rule!.style
    expect([s.getPropertyValue('left'), s.getPropertyPriority('left')]).toEqual(['16px', 'important'])
    expect(s.getPropertyValue('right')).toBe('auto')
    expect(s.getPropertyValue('width')).toBe('calc(100vw - 32px)')
    expect(s.getPropertyValue('max-width')).toBe('calc(100vw - 32px)')
  })
})

describe('index.css Alert title (M3, TYP-01)', () => {
  it('sets an Alert\'s title over its description as a card title, 15/600, on both themes', () => {
    for (const theme of [adminTheme, fieldTheme]) {
      const { container, unmount } = render(
        <ConfigProvider theme={theme}>
          <Alert type="error" message="Không tải được dự án" description="Thử lại sau." />
        </ConfigProvider>,
      )
      const title = container.querySelector('.ant-alert-message') as HTMLElement
      expect(getComputedStyle(title).fontSize).toBe('15px')
      expect(getComputedStyle(title).fontWeight).toBe('600')
      unmount()
    }
  })
})

describe('index.css collapsible card toggle (COL-01)', () => {
  it('rings the toggle on keyboard focus', () => {
    const ring = Array.from(sheet.sheet!.cssRules)
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .find((r) => r.selectorText === '.pp-card-toggle:focus-visible')
    expect(ring).toBeDefined()
    expect(ring!.style.outline).toMatch(/2px solid/)
  })
})
