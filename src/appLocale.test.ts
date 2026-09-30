import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appLocale } from './appLocale'

/** Every source file under src, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('the app locale (AD3, UI-05)', () => {
  it('is Vietnamese, down to the pager: "10 / trang"', () => {
    expect(appLocale.locale).toBe('vi')
    expect(appLocale.Pagination?.items_per_page).toBe('/ trang')
  })

  it('comes from antd\'s ES build, never the CommonJS entry the production bundle wraps', () => {
    // `antd/locale/vi_VN` is `module.exports = require('../lib/…')`. Rolldown
    // imports it Node-style, so its default is the whole exports object
    // ({ default, __esModule }) and ConfigProvider found no `Pagination` in
    // it: the live pager read "10 / page" while every test read "/ trang".
    const offenders = sources(resolve(import.meta.dirname))
      .filter((file) => /from ['"]antd\/(locale|lib)\//.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
