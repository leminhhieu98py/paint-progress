import { Alert, Button, Input, InputNumber, Modal, Space, Table, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Stage } from '../../domain/types'
import { listStages, saveStages, STAGE_WEIGHT_EPSILON } from '../../lib/projectsApi'

type DraftStage = Omit<Stage, 'id'>

export function StageConfigPanel({ projectId }: { projectId: string }) {
  const [draft, setDraft] = useState<DraftStage[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const stages = await listStages(projectId)
      setDraft(stages.map(({ seq, name, color, weight }) => ({ seq, name, color, weight })))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const total = useMemo(() => draft.reduce((sum, s) => sum + s.weight, 0), [draft])
  const balanced = Math.abs(total - 1) <= STAGE_WEIGHT_EPSILON

  const patch = (index: number, change: Partial<DraftStage>) =>
    setDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...change } : s)))

  /** seq is renumbered 1..n on every structural change: cumulative progress
   *  reads stages by seq, so a gap or a tie would corrupt every percentage. */
  const renumber = (rows: DraftStage[]) => rows.map((s, i) => ({ ...s, seq: i + 1 }))

  const addStage = () =>
    setDraft((prev) =>
      renumber([...prev, { seq: 0, name: 'Lớp mới', color: '#8c8c8c', weight: 0 }]),
    )

  const removeStage = (index: number) =>
    setDraft((prev) => renumber(prev.filter((_s, i) => i !== index)))

  const move = (index: number, delta: number) =>
    setDraft((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return renumber(next)
    })

  const onSave = async () => {
    setBusy(true)
    try {
      await saveStages(projectId, draft)
      setError(null)
      setConfirming(false)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}
      {!balanced && (
        <Alert
          type="warning"
          message={`Tổng trọng số phải bằng 1.00 — hiện tại ${total.toFixed(4)}`}
          description="Mọi phần trăm tiến độ đều tính từ các trọng số này, nên không lưu được khi tổng lệch."
        />
      )}

      <Table<DraftStage>
        rowKey="seq"
        size="small"
        loading={loading}
        dataSource={draft}
        pagination={false}
        columns={[
          { title: 'Thứ tự', dataIndex: 'seq', width: 80 },
          {
            title: 'Tên lớp',
            dataIndex: 'name',
            render: (v: string, _r, i) => (
              <Input value={v} onChange={(e) => patch(i, { name: e.target.value })} />
            ),
          },
          {
            title: 'Màu',
            dataIndex: 'color',
            width: 110,
            render: (v: string, _r, i) => (
              <Input type="color" value={v} onChange={(e) => patch(i, { color: e.target.value })} />
            ),
          },
          {
            title: 'Trọng số',
            dataIndex: 'weight',
            width: 130,
            render: (v: number, _r, i) => (
              <InputNumber
                value={v}
                min={0}
                max={1}
                // No explicit `step`/`precision`: rc-input-number derives the
                // displayed precision from max(precision of value, precision
                // of step). A step with more decimals than the stored weight
                // (e.g. 0.05) pads the display -- 0.6 renders as "0.60" -- so
                // the input silently stops mirroring the raw stored number.
                // Leaving step at its default (1, precision 0) lets the
                // value's own digits decide the display.
                onChange={(n) => patch(i, { weight: n ?? 0 })}
              />
            ),
          },
          {
            title: '',
            key: 'actions',
            width: 200,
            render: (_v, _r, i) => (
              <Space size="small">
                <Button size="small" disabled={i === 0} onClick={() => move(i, -1)}>
                  Lên
                </Button>
                <Button size="small" disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                  Xuống
                </Button>
                <Button size="small" danger disabled={draft.length === 1} onClick={() => removeStage(i)}>
                  Xoá
                </Button>
              </Space>
            ),
          },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}>
              <Typography.Text strong>Tổng</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3}>
              <Typography.Text type={balanced ? 'success' : 'danger'} strong>
                {total.toFixed(4)}
              </Typography.Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      <Space>
        <Button type="primary" disabled={!balanced} loading={busy} onClick={() => setConfirming(true)}>
          Lưu
        </Button>
        <Button onClick={addStage}>Thêm lớp</Button>
      </Space>

      <Modal
        open={confirming}
        title="Lưu cấu hình lớp sơn?"
        okText="Vẫn lưu"
        cancelText="Huỷ"
        confirmLoading={busy}
        onCancel={() => setConfirming(false)}
        onOk={() => void onSave()}
      >
        <Typography.Paragraph>
          Lưu danh sách lớp sơn sẽ <strong>xoá toàn bộ tiến độ đã ghi</strong> của
          dự án này: mọi ô đang ở một lớp nào đó sẽ trở về trạng thái chưa bắt đầu.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Lý do: tiến độ của mỗi ô trỏ tới một lớp cụ thể, và lưu ở đây thay thế cả
          danh sách lớp nên các liên kết đó bị cắt. Trong lúc đang khai báo sàn thì
          vô hại — nhưng khi giám sát đã tick thật thì không hoàn tác được.
        </Typography.Paragraph>
      </Modal>
    </Space>
  )
}
