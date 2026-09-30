import { type } from '../theme'

/**
 * A name with its code in brackets, "Main Deck (MD)", in one column (RLP-01):
 * decks and projects alike. The name is its own span, so it reads alone
 * where a test or a reader looks for it.
 */
export function NameWithCode({ name, code }: { name: string; code: string }) {
  return (
    <span style={type.body}>
      <span>{name}</span>
      {` (${code})`}
    </span>
  )
}
