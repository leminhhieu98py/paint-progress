/**
 * AES-GCM around the admin-readable GS passwords.
 *
 * The key lives only in this function's environment, so a database dump on its
 * own does not yield passwords. See spec §7.2 for the accepted risk.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

export async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key)
  if (raw.length !== 32) {
    throw new Error('CRED_ENC_KEY must be 32 bytes, base64-encoded')
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** Returns "<iv-base64>.<ciphertext-base64>". */
export async function encryptSecret(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ct))}`
}

export async function decryptSecret(key: CryptoKey, stored: string): Promise<string> {
  const [ivPart, ctPart] = stored.split('.')
  if (!ivPart || !ctPart) throw new Error('Malformed stored secret')
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    key,
    fromBase64(ctPart),
  )
  return dec.decode(pt)
}
