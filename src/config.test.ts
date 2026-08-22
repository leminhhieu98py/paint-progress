import { describe, expect, it } from 'vitest'
import { AUTH_EMAIL_SUFFIX, toAuthEmail } from './config'

describe('toAuthEmail', () => {
  it('appends the app suffix to a bare username', () => {
    expect(toAuthEmail('linhdeptrai123')).toBe('linhdeptrai123@app.local')
  })

  it('does not append the app suffix when the identifier already contains @', () => {
    expect(toAuthEmail('someone@example.com')).toBe('someone@example.com')
  })

  it('trims surrounding whitespace and lowercases', () => {
    expect(toAuthEmail('  LinhDepTrai123  ')).toBe('linhdeptrai123@app.local')
  })

  it('exposes the suffix as a constant', () => {
    expect(AUTH_EMAIL_SUFFIX).toBe('@app.local')
  })

  it('normalises an @-containing identifier rather than passing it through literally', () => {
    expect(toAuthEmail('  Someone@Example.COM  ')).toBe('someone@example.com')
  })

  it('does not append the suffix to an identifier that already has a domain', () => {
    expect(toAuthEmail('Someone@Example.COM')).not.toContain('@app.local')
  })

  it('appends the suffix to an empty identifier rather than throwing', () => {
    expect(toAuthEmail('')).toBe('@app.local')
  })
})
