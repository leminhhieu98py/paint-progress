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
/**
 * A size set through a props object (`okButtonProps={{ size: 'large' }}`,
 * a shared props helper) is the same override (AD review M5). The one kept is
 * the Table's own pagination, which is not a form control and sits under the
 * table, never beside one.
 */
const ALLOWED_OBJECTS = ['components/tablePagination.ts']

function sources(dir: string, pattern = /\.tsx$/): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path, pattern)
    return pattern.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Every `size: 'small' | 'large'` in an object literal, as `file:line`. */
function sizedObjects(root: string): string[] {
  const found: string[] = []
  for (const file of sources(root, /\.tsx?$/)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\bsize:\s*['"](small|large)['"]/g)) {
      const line = text.slice(0, m.index).split('\n').length
      found.push(`${relative(root, file)}:${line}`)
    }
  }
  return found
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

  it('sets no small or large size through a props object either (AD review M5)', () => {
    const offenders = sizedObjects(resolve(import.meta.dirname))
      .filter((o) => !ALLOWED_OBJECTS.some((file) => o.startsWith(`${file}:`)))
    expect(offenders).toEqual([])
  })
})
