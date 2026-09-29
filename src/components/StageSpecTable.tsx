import { Table, type TableProps } from 'antd'
import type { StageProgress } from '../domain/types'
import { DEFAULT_UNIT } from '../domain/unit'
import { formatAreaM2, formatPercent } from '../lib/format'

interface SpecRow {
  key: string
  label: string
  /** One entry per stage, keyed by stage id, pre-formatted. */
  [stageId: string]: string
}

/**
 * The `Dashboard` sheet's two rows, per deck: cumulative m² at each stage and
 * that area as a share of the whole deck.
 *
 * Both come from computeDeckProgress, which is asserted against the customer's
 * own spreadsheet to 1e-9 (spec §3.3). Nothing is recomputed here -- a second
 * implementation of A_i or p_i is a second thing that can disagree with the
 * report.
 *
 * The row labels are the workbook's, in English, deliberately: spec §8.1
 * requires this table to mirror that sheet exactly, and these two strings are
 * what the foreman already reads on the printout.
 */
export function StageSpecTable({ stages, unit = DEFAULT_UNIT }: {
  stages: StageProgress[]
  /** The work's unit (RV6-35); the quantity row is labelled with it. */
  unit?: string
}) {
  const columns: TableProps<SpecRow>['columns'] = [
    { title: '', dataIndex: 'label', key: 'label', fixed: 'left', width: 120 },
    ...stages.map((sp) => ({
      title: sp.stage.name,
      dataIndex: sp.stage.id,
      key: sp.stage.id,
      align: 'right' as const,
    })),
  ]

  const dataSource: SpecRow[] =
    stages.length === 0
      ? []
      : [
          {
            key: 'area',
            label: unit,
            ...Object.fromEntries(
              stages.map((sp) => [sp.stage.id, formatAreaM2(sp.cumulativeAreaM2)]),
            ),
          },
          {
            key: 'ratio',
            label: '% Total Deck',
            ...Object.fromEntries(stages.map((sp) => [sp.stage.id, formatPercent(sp.ratio)])),
          },
        ]

  return (
    <Table<SpecRow>
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      size="small"
      // Not `bordered`: its only use sits flush inside a card (A3.6), whose own
      // border would otherwise double the table's outer hairline.
      sticky
      // A project with many stages must scroll sideways rather than squeeze
      // every column to unreadable width on a tablet.
      scroll={{ x: 'max-content' }}
    />
  )
}
