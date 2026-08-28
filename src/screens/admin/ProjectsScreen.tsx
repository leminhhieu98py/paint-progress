import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Modal, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { Mono } from '../../components/Mono'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProgressBar } from '../../components/ProgressBar'
import { SectionCard } from '../../components/SectionCard'
import { StatCard } from '../../components/StatCard'
import { formatAreaM2 } from '../../lib/format'
import { latestProgressEvent, type ProgressEvent } from '../../lib/progressApi'
import { createProject, listProjects, updateProject, type ProjectRow } from '../../lib/projectsApi'
import { palette } from '../../theme'

interface CreateValues {
  name: string
  code: string
}

const COUNT = new Intl.NumberFormat('vi-VN')

/**
 * When the last stage change happened, at the precision that is useful.
 *
 * A bare "09:42" is what the prototype shows and it is right for the common
 * case -- somebody recorded something this morning. It is wrong for the case
 * that matters more: nothing has been recorded in three weeks, and "09:42"
 * reads as though the site is busy.
 */
function eventTime(iso: string): string {
  const at = dayjs(iso)
  return at.isSame(dayjs(), 'day') ? at.format('HH:mm') : at.format('DD.MM · HH:mm')
}

function eventDetail(e: ProgressEvent): string {
  const who = e.byUsername ?? e.byName ?? 'không rõ'
  // A null stage is a bay sent back to the start -- a real and consequential
  // thing a foreman does. Printing "R7C11 → " would read as a rendering bug.
  return `${who} · ${e.cellCode} → ${e.toStageName ?? 'Chưa bắt đầu'}`
}

export function ProjectsScreen() {
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [event, setEvent] = useState<ProgressEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectRow | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listProjects())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*
    Fetched separately from the project list, and its failure is swallowed on
    purpose. The counters are a nicety; the table is the screen. A permission
    problem on cell_events must not blank the projects the admin came for, and
    an empty counter says the same thing as an error would.
  */
  useEffect(() => {
    let cancelled = false
    latestProgressEvent()
      .then((e) => {
        if (!cancelled) setEvent(e)
      })
      .catch(() => {
        if (!cancelled) setEvent(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onCreate = async (values: CreateValues) => {
    try {
      await createProject(values)
      setCreateOpen(false)
      setError(null)
      await refresh()
    } catch (e) {
      // Deliberately leaves the modal open so the typed values survive.
      setError((e as Error).message)
    }
  }

  const onUpdate = async (id: string, values: CreateValues) => {
    try {
      await updateProject(id, values)
      setEditing(null)
      setError(null)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const totals = rows.reduce(
    (a, r) => ({
      area: a.area + r.totalAreaM2,
      decks: a.decks + r.deckCount,
      drawn: a.drawn + r.decksWithDrawing,
      cells: a.cells + r.cellCount,
    }),
    { area: 0, decks: 0, drawn: 0, cells: 0 },
  )

  return (
    <>
      <PageHeader
        title="Dự án"
        subtitle={`${rows.length} dự án · ${totals.decks} sàn · tiến độ tính từ diện tích`}
        extra={
          /*
            aria-hidden on an icon that sits beside its own visible label.
            @ant-design/icons renders role="img" aria-label="plus", which
            would otherwise join the button's accessible name -- the button
            stops being reachable as "Tạo dự án" by a screen reader, and by a
            test. Icon-only buttons carry their own aria-label instead, which
            overrides the icon's.
          */
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setCreateOpen(true)}
          >
            Tạo dự án
          </Button>
        }
      />

      <PageBody>
        {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))',
            gap: 14,
          }}
        >
          <StatCard
            label="Tổng diện tích"
            value={formatAreaM2(totals.area)}
            sub={`m² trên ${rows.length} dự án`}
          />
          <StatCard
            label="Số sàn theo dõi"
            value={COUNT.format(totals.decks)}
            sub={`${totals.drawn} sàn đã có bản vẽ`}
          />
          <StatCard
            label="Ô đã dựng"
            value={COUNT.format(totals.cells)}
            sub="trên toàn bộ bản vẽ"
          />
          <StatCard
            label="Ghi nhận gần nhất"
            tone="accent"
            live={event !== null}
            value={event ? eventTime(event.at) : '—'}
            sub={event ? eventDetail(event) : 'Chưa có ghi nhận nào'}
          />
        </div>

        <SectionCard bodyPadding={0}>
          <Table<ProjectRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={false}
            columns={[
              {
                title: 'Tên dự án',
                dataIndex: 'name',
                render: (_v, row) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Mono
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        background: palette.bgHover,
                        color: palette.textSecondary,
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: '32px',
                        textAlign: 'center',
                        flex: 'none',
                      }}
                    >
                      {row.code.slice(0, 2).toUpperCase()}
                    </Mono>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, lineHeight: 1.35 }}>{row.name}</div>
                      <Mono style={{ fontSize: 11, color: palette.textTertiary }}>{row.code}</Mono>
                    </div>
                  </div>
                ),
              },
              { title: 'Số sàn', dataIndex: 'deckCount', width: 100, align: 'right' },
              {
                title: 'Tổng diện tích (m²)',
                dataIndex: 'totalAreaM2',
                width: 180,
                align: 'right',
                render: (v: number) => formatAreaM2(v),
              },
              {
                title: 'Tiến độ',
                dataIndex: 'progress',
                width: 240,
                render: (v: number) => <ProgressBar ratio={v} />,
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 100,
                align: 'right',
                render: (_v, row) => (
                  <Tooltip title="Sửa dự án">
                    <Button
                      size="small"
                      aria-label="Sửa"
                      icon={<EditOutlined />}
                      onClick={() => setEditing(row)}
                    />
                  </Tooltip>
                ),
              },
            ]}
          />
        </SectionCard>
      </PageBody>

      <Modal
        open={createOpen || editing !== null}
        title={editing ? 'Sửa dự án' : 'Tạo dự án'}
        onCancel={() => {
          setCreateOpen(false)
          setEditing(null)
        }}
        footer={null}
        destroyOnHidden
      >
        <Form<CreateValues>
          layout="vertical"
          initialValues={editing ? { name: editing.name, code: editing.code } : undefined}
          onFinish={(v) => void (editing ? onUpdate(editing.id, v) : onCreate(v))}
        >
          <Form.Item name="name" label="Tên dự án" rules={[{ required: true, message: 'Nhập tên dự án' }]}>
            <Input placeholder="Ví dụ: Bạch Hổ BH-7 Repaint" />
          </Form.Item>
          <Form.Item
            name="code"
            label="Mã dự án"
            rules={[{ required: true, message: 'Nhập mã dự án' }]}
            extra="Mã là duy nhất trên toàn hệ thống."
          >
            <Input placeholder="Ví dụ: BH7-RPT" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {editing ? 'Lưu' : 'Tạo'}
          </Button>
        </Form>
      </Modal>
    </>
  )
}
