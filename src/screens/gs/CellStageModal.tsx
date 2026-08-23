import { Alert, Button, Modal, Select, Space, Typography } from 'antd'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { isBackwards, nextStage } from '../../domain/stageFlow'
import type { Cell, Stage } from '../../domain/types'
import { formatAreaM2 } from '../../lib/format'

/**
 * antd's Select cannot carry `null` as an option value (it is indistinguishable
 * from "no selection"), so "not started" needs a sentinel. It never leaves this
 * module: onCommit receives null.
 */
export const NOT_STARTED_VALUE = '__not-started__'

const NOT_STARTED_LABEL = 'Chưa bắt đầu'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong>{children}</Typography.Text>
    </div>
  )
}

export function CellStageModal({
  cell,
  stages,
  open,
  onClose,
  onCommit,
}: {
  cell: Cell | null
  stages: Stage[]
  open: boolean
  onClose: () => void
  /**
   * Fire and forget. The caller owns the optimistic update and the rollback, and
   * must not reject: spec §11 row 1 wants the chart to move with no perceptible
   * delay, so this modal closes immediately rather than awaiting the write.
   */
  onCommit: (cellId: string, stageId: string | null) => void
}) {
  const [choice, setChoice] = useState<string>(NOT_STARTED_VALUE)

  // Keyed on the cell's ID only, deliberately. A realtime update to the cell
  // being edited must not silently rewrite the foreman's pending selection --
  // and re-running on every stageId change would do exactly that, including
  // straight after this modal's own optimistic update.
  useEffect(() => {
    setChoice(cell?.stageId ?? NOT_STARTED_VALUE)
  }, [cell?.id])

  const ordered = useMemo(() => [...stages].sort((a, b) => a.seq - b.seq), [stages])
  const chosenStageId = choice === NOT_STARTED_VALUE ? null : choice
  const currentStage = stages.find((s) => s.id === cell?.stageId) ?? null
  const next = nextStage(stages, cell?.stageId ?? null)
  const backwards = cell !== null && isBackwards(stages, cell.stageId, chosenStageId)
  const unchanged = cell !== null && chosenStageId === cell.stageId

  return (
    <Modal
      open={open}
      title={cell ? `Ô ${cell.code}` : ''}
      onCancel={onClose}
      onOk={() => {
        if (!cell || unchanged) return
        onCommit(cell.id, chosenStageId)
        onClose()
      }}
      okText="Xác nhận"
      cancelText="Huỷ"
      okButtonProps={{ disabled: unchanged, size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
      destroyOnHidden
    >
      {cell && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/*
            Grouped under one testid so a test can assert what the INFO rows say
            rather than what the whole modal contains: the Select renders its
            selected option's label, so "Coat 2" appears both here and there, and
            an unscoped query cannot tell which one it found -- it would pass on
            a modal that had lost this row entirely.
          */}
          <div
            data-testid="cell-stage-info"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Field label="Mã ô">{cell.code}</Field>
            <Field label="Diện tích">{formatAreaM2(cell.areaM2)} m²</Field>
            <Field label="Công đoạn hiện tại">{currentStage?.name ?? NOT_STARTED_LABEL}</Field>
            <Field label="Công đoạn tiếp theo">{next?.name ?? 'Đã xong công đoạn cuối'}</Field>
          </div>

          {/*
            One tap for the case that happens all day: advance this bay by one
            stage. Always computed from the cell's CURRENT stage, never from the
            Select -- the two are independent on purpose, so a foreman who opened
            the dropdown to look and then wanted the ordinary next stage is not
            committing whatever they left highlighted. Forward by construction,
            so isBackwards is false on this path and the red warning below
            belongs to the Select.
          */}
          {next && (
            <Button
              type="primary"
              size="large"
              block
              onClick={() => {
                onCommit(cell.id, next.id)
                onClose()
              }}
            >
              Xong công đoạn tiếp theo: {next.name}
            </Button>
          )}

          <div>
            <Typography.Text type="secondary">
              {next ? 'Hoặc chọn công đoạn khác' : 'Chọn công đoạn'}
            </Typography.Text>
            <Select
              aria-label="Công đoạn"
              size="large"
              style={{ width: '100%', marginTop: 4 }}
              value={choice}
              onChange={setChoice}
              options={[
                { value: NOT_STARTED_VALUE, label: NOT_STARTED_LABEL },
                ...ordered.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>

          {backwards && (
            <Alert
              type="error"
              showIcon
              message="Đang chuyển ô về công đoạn trước"
              description="Tiến độ đã ghi của ô này sẽ bị hạ xuống. Chỉ làm khi thực sự cần sửa sai."
            />
          )}
        </Space>
      )}
    </Modal>
  )
}
