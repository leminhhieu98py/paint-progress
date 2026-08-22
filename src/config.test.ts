import { describe, expect, it } from 'vitest'
import { AUTH_EMAIL_SUFFIX, toAuthEmail } from './config'

describe('toAuthEmail', () => {
  it('appends the app suffix to a bare username', () => {
    expect(toAuthEmail('linhdeptrai123')).toBe('linhdeptrai123@app.local')
  })

  it('passes an identifier that already contains @ through unchanged', () => {
    expect(toAuthEmail('someone@example.com')).toBe('someone@example.com')
  })

  it('trims surrounding whitespace and lowercases', () => {
    expect(toAuthEmail('  LinhDepTrai123  ')).toBe('linhdeptrai123@app.local')
  })

  it('exposes the suffix as a constant', () => {
    expect(AUTH_EMAIL_SUFFIX).toBe('@app.local')
  })
})
