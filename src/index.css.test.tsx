import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { Modal, Table } from 'antd'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tablePagination } from './components/tablePagination'

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
