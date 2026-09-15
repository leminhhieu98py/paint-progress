import { Input } from 'antd'

/**
 * Six digits with the hash, which is the only form the native swatch and the
 * `stages.color` / `decks.kpi_*_color` columns all accept. Three-digit
 * shorthand is deliberately not allowed: `#abc` would have to be expanded
 * before storage, and two stages whose colours differ only by that expansion
 * would read as a clash to the duplicate check but not to the admin typing
 * them.
 */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * A native colour swatch with a typable hex beside it -- the pair
 * StageConfigPanel has used for a coat's colour since the hex field was added,
 * lifted out so the KPI colour table (RV6-28) shows the very same control.
 *
 * Controlled, and split in two on purpose: `value` is always a real colour
 * (it feeds the swatch, which cannot show "#12"), and `hex` is what the admin
 * has typed for as long as it is not yet one. The caller owns both, because
 * what a half-typed hex MEANS differs per screen -- the stage panel holds its
 * save shut on it, the KPI table lets it go on blur (RV6-31) -- and the field
 * has no business deciding that. `onColor` fires only with a complete colour:
 * a swatch pick, or a typed hex the regex accepts, lowercased so two spellings
 * of one colour cannot land as two values.
 */
export function ColorField({
  label,
  value,
  hex,
  disabled = false,
  onColor,
  onHex,
  onHexBlur,
}: {
  /** What the two inputs are named after: `Chọn màu · {label}`, `Mã màu · {label}`. */
  label: string
  /** The colour the swatch shows. Always `#RRGGBB`. */
  value: string
  /** The hex field's text while it is not yet a colour; `undefined` shows `value`. */
  hex?: string
  disabled?: boolean
  /** A complete colour, lowercased. */
  onColor: (color: string) => void
  /** The hex field's text on every change, verbatim, and the swatch's pick too. */
  onHex: (typed: string) => void
  onHexBlur?: () => void
}) {
  const shown = hex ?? value
  const valid = HEX_COLOR.test(shown)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <Input
        aria-label={`Chọn màu · ${label}`}
        type="color"
        value={value}
        disabled={disabled}
        style={{ width: 44, padding: 2 }}
        onChange={(e) => {
          onColor(e.target.value)
          onHex(e.target.value)
        }}
      />
      {/*
        The hex beside the swatch, not instead of it, and typable. A foreman
        reads the colour off a drawing; an admin comparing this deck's config
        against another one reads the code, and a colour that arrives as text
        -- off a paint spec, over the phone -- has nowhere else to go: the
        native swatch takes no keyboard and no paste.
      */}
      <Input
        aria-label={`Mã màu · ${label}`}
        aria-invalid={valid ? undefined : true}
        placeholder="#RRGGBB"
        maxLength={7}
        status={valid ? undefined : 'error'}
        value={shown}
        disabled={disabled}
        style={{ width: 104 }}
        onChange={(e) => {
          const typed = e.target.value
          onHex(typed)
          // Only a complete colour is reported as one. Everything else stays
          // visible in the field for the caller to hold or let go.
          if (HEX_COLOR.test(typed)) onColor(typed.toLowerCase())
        }}
        onBlur={onHexBlur}
      />
    </span>
  )
}
