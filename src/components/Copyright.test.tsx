import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { palette } from '../theme'
import { COPYRIGHT } from '../test/copy'
import { Copyright } from './Copyright'

// RV7-2: the customer's line, word for word, on every screen.
describe('Copyright', () => {
  it('is one caption line, secondary colour, right aligned, in the page flow', () => {
    render(<Copyright />)
    const line = screen.getByText(COPYRIGHT)
    expect(line).toHaveStyle({
      fontSize: '12px',
      fontWeight: '400',
      color: palette.textSecondary,
      textAlign: 'right',
    })
    // Never fixed over content (owner, RV7-2).
    expect(line.style.position).toBe('')
  })
})

// The developer's credit lives in the HTML and the package only, never on
// screen (owner 2026-10-01).
describe('author credit', () => {
  const root = resolve(import.meta.dirname, '../..')

  it('names the developer in the page’s author meta', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8')
    expect(html).toContain('<meta name="author" content="Lập trình viên: Lê Minh Hiếu" />')
  })

  it('names the developer as the package author', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { author?: string }
    expect(pkg.author).toBe('Lê Minh Hiếu')
  })
})
