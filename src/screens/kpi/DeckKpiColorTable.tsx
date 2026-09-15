import { Button, Table } from 'antd'
import { useState } from 'react'
import { ColorField, HEX_COLOR } from '../../components/ColorField'
import { SectionCard } from '../../components/SectionCard'
import { KPI_COLOR_DEFAULTS } from '../dashboard/kpiColors'

/**
 * Màu biểu đồ theo sàn — the admin picks the KPI chart's Plan and Actual
 * colours per deck (Feedback Rv6 item 5c, rules RV6-28, RV6-30, RV6-31).
 *
 * Presentational, the same contract `StagePlanTable` has: the decks arrive with
 * their stored colours and every write goes out through `onChange`, so this
 * file holds the two fields and the reset link and nothing about where a
 * colour is stored. Admin-only by the route; the GS variant of the KPI screen
 * never mounts it.
 *
 * There is no save step (RV6-28: "writes happen on change"), so what the two
 * fields show between a keystroke and the reload is the whole state this
 * component keeps: `hexDraft`, keyed by deck and family, holds what the admin
 * has typed for as long as the hex field has focus. A complete colour is
 * written the moment it is complete; an incomplete one is written nowhere and
 * is let go when the field blurs, so the field shows the stored colour again
 * (RV6-31) -- unlike `StageConfigPanel`, which has a save to hold shut.
 */

/** One deck as the table wants it: identity plus its two stored colours. */
export interface DeckKpiColorRow {
  id: string
  name: string
  /** Null: the system default (RV6-30). */
  kpiPlanColor: string | null
  kpiActualColor: string | null
}

export interface DeckKpiColors {
  plan: string | null
  actual: string | null
}

type Family = 'plan' | 'actual'

const FAMILY_LABEL: Record<Family, string> = { plan: 'Kế hoạch', actual: 'Thực hiện' }

const stored = (row: DeckKpiColorRow, family: Family) =>
  family === 'plan' ? row.kpiPlanColor : row.kpiActualColor

export function DeckKpiColorTable({
  decks,
  onChange,
  saving,
}: {
  decks: DeckKpiColorRow[]
  /** Both colours, every time: null returns that family to the default. */
  onChange: (deckId: string, colors: DeckKpiColors) => void
  saving: boolean
}) {
  const [hexDraft, setHexDraft] = useState<Record<string, string>>({})
  const draftKey = (deckId: string, family: Family) => `${deckId}:${family}`

  const write = (row: DeckKpiColorRow, family: Family, color: string | null) => {
    onChange(row.id, {
      plan: family === 'plan' ? color : row.kpiPlanColor,
      actual: family === 'actual' ? color : row.kpiActualColor,
    })
  }

  const field = (row: DeckKpiColorRow, family: Family) => {
    const key = draftKey(row.id, family)
    const draft = hexDraft[key]
    // The swatch shows the draft as soon as it is a colour, not only after the
    // reload lands: a controlled swatch that snapped back to the stored colour
    // on every drag would fight the picker the admin is dragging in.
    const shown = draft !== undefined && HEX_COLOR.test(draft)
      ? draft.toLowerCase()
      : (stored(row, family) ?? KPI_COLOR_DEFAULTS[family]).toLowerCase()
    return (
      <ColorField
        label={`${FAMILY_LABEL[family]} · ${row.name}`}
        value={shown}
        hex={draft}
        disabled={saving}
        onColor={(color) => write(row, family, color)}
        onHex={(typed) => setHexDraft((d) => ({ ...d, [key]: typed }))}
        onHexBlur={() => setHexDraft((d) => {
          const rest = { ...d }
          delete rest[key]
          return rest
        })}
      />
    )
  }

  const styled = decks.filter((d) => d.kpiPlanColor !== null || d.kpiActualColor !== null).length

  return (
    <SectionCard
      title="Màu biểu đồ theo sàn"
      summary={`${decks.length} sàn · ${styled} sàn có màu riêng`}
      collapsible
      defaultOpen={false}
      bodyPadding={0}
    >
      <Table<DeckKpiColorRow>
        className="pp-table"
        rowKey="id"
        size="middle"
        dataSource={decks}
        pagination={false}
        scroll={{ x: true }}
        onRow={(row) => ({ 'data-testid': `deck-color-row-${row.id}` } as React.HTMLAttributes<HTMLElement>)}
        columns={[
          { title: 'Sàn', dataIndex: 'name', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
          { title: 'Kế hoạch', key: 'plan', width: 190, render: (_v, row) => field(row, 'plan') },
          { title: 'Thực hiện', key: 'actual', width: 190, render: (_v, row) => field(row, 'actual') },
          {
            key: 'reset',
            width: 110,
            render: (_v, row) => (
              <Button
                type="link"
                size="small"
                aria-label={`Mặc định · ${row.name}`}
                // Nothing to clear on a deck already at the defaults: the
                // write would be a no-op and the reload it triggers a cost.
                disabled={saving || (row.kpiPlanColor === null && row.kpiActualColor === null)}
                onClick={() => onChange(row.id, { plan: null, actual: null })}
              >
                Mặc định
              </Button>
            ),
          },
        ]}
      />
    </SectionCard>
  )
}
