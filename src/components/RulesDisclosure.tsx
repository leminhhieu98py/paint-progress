import { DownOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { palette } from '../theme'
import { Mono } from './Mono'

export interface Rule {
  /** The spec's own id, e.g. STG-R1. Same name on screen and in the spec. */
  id: string
  text: string
}

/**
 * The business rules that govern a panel, folded away under it.
 *
 * These are the rules an admin hits and then has to guess at: why Save is
 * locked, why the area field rejected what they typed, what deleting a stage
 * does to the bays already recorded against it. Written into the panel they
 * apply to, they answer the question at the moment it is asked.
 *
 * Collapsed by default -- someone using the screen daily does not need them,
 * and expanded by default they would push the actual work below the fold.
 */
export function RulesDisclosure({ rules }: { rules: Rule[] }) {
  const [open, setOpen] = useState(false)
  if (rules.length === 0) return null

  return (
    <div
      style={{
        borderTop: `1px solid ${palette.borderSplit}`,
        background: open ? palette.bgSubtle : palette.bgContainer,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '12px 20px',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          font: 'inherit',
          color: palette.textSecondary,
        }}
      >
        <InfoCircleOutlined style={{ color: palette.accent }} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Quy tắc áp dụng</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1,
            color: palette.accent,
            background: palette.accentTint,
            padding: '4px 7px',
            borderRadius: 999,
          }}
        >
          {rules.length}
        </span>
        <DownOutlined
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: palette.textTertiary,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .15s ease',
          }}
        />
      </button>

      {open && (
        <div style={{ padding: '0 20px 14px' }}>
          {rules.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                padding: '9px 0',
                borderTop: `1px solid ${palette.borderSplit}`,
              }}
            >
              <Mono
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: palette.accent,
                  background: palette.accentTint,
                  padding: '5px 6px',
                  borderRadius: 6,
                  flex: 'none',
                  minWidth: 58,
                  textAlign: 'center',
                }}
              >
                {r.id}
              </Mono>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: palette.textSecondary }}>
                {r.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
