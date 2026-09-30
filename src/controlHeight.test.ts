import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CTL-02 (owner 2026-09-30): one control height per theme -- the admin
 * theme's 38 everywhere in admin, the field theme's 48 on field screens. No
 * form control, and no button beside one, carries `size="small"` or
 * `size="large"`. This guard reads every source file, since a size is a prop
 * a screen can add anywhere. The allow-list is empty on purpose.
 */
const CONTROLS = [
  'Input', 'Input.Search', 'Input.Password', 'Input.TextArea', 'InputNumber', 'Select', 'AutoComplete',
  'DatePicker', 'DatePicker.RangePicker', 'RangePicker', 'TimePicker', 'Button', 'Segmented', 'Form',
  'ColorField',
]
const ALLOWED: string[] = []

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

/**
 * The opening tag starting at `from` (the `<`) whose name ends at `nameEnd`,
 * braces balanced, up to its `>`; a type argument (`<Form<Values>`) skipped.
 */
function openingTag(text: string, from: number, nameEnd: number): string {
  let depth = 0
  let start = nameEnd
  if (text[start] === '<') {
    let generic = 0
    for (; start < text.length; start++) {
      if (text[start] === '<') generic++
      else if (text[start] === '>' && --generic === 0) { start++; break }
    }
  }
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return text.slice(from, i + 1)
  }
  return text.slice(from)
}

/** Every `<Control … size=…>` in the source, as `file:line <Control>`. */
function sizedControls(root: string): string[] {
  const found: string[] = []
  const names = CONTROLS.map((n) => n.replace('.', '\\.')).join('|')
  const open = new RegExp(`<(${names})(?=[\\s>/<])`, 'g')
  for (const file of sources(root)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(open)) {
      const tag = openingTag(text, m.index ?? 0, (m.index ?? 0) + m[0].length)
      if (/\ssize=/.test(tag)) {
        const line = text.slice(0, m.index).split('\n').length
        found.push(`${relative(root, file)}:${line} <${m[1]}>`)
      }
    }
  }
  return found
}

describe('one control height per theme (CTL-02)', () => {
  it('gives no form control, and no button, a size of its own', () => {
    const offenders = sizedControls(resolve(import.meta.dirname)).filter((o) => !ALLOWED.includes(o))
    expect(offenders).toEqual([])
  })
})
