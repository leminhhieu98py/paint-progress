import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, importKey } from './crypto'

const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

describe('credential crypto', () => {
  it('round-trips a password', async () => {
    const key = await importKey(KEY_B64)
    const stored = await encryptSecret(key, 'conglinb-example')
    expect(await decryptSecret(key, stored)).toBe('conglinb-example')
  })

  it('produces a different ciphertext each time for the same input', async () => {
    const key = await importKey(KEY_B64)
    const a = await encryptSecret(key, 'same')
    const b = await encryptSecret(key, 'same')
    expect(a).not.toBe(b)
  })

  it('round-trips non-ASCII characters', async () => {
    const key = await importKey(KEY_B64)
    const stored = await encryptSecret(key, 'mật-khẩu-tiếng-việt')
    expect(await decryptSecret(key, stored)).toBe('mật-khẩu-tiếng-việt')
  })

  it('rejects a key of the wrong length', async () => {
    await expect(importKey(btoa('short'))).rejects.toThrow(/32 bytes/)
  })

  it('rejects a key that is not valid base64, with the same helpful message', async () => {
    await expect(importKey('not-valid-base64!')).rejects.toThrow(/32 bytes/)
  })

  it('rejects a malformed stored secret', async () => {
    const key = await importKey(KEY_B64)
    await expect(decryptSecret(key, 'nodot')).rejects.toThrow(/Malformed/)
  })

  it('fails to decrypt with the wrong key', async () => {
    const stored = await encryptSecret(await importKey(KEY_B64), 'x')
    const other = await importKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(9))))
    await expect(decryptSecret(other, stored)).rejects.toThrow(/operation|OperationError/i)
  })
})
