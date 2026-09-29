import {
  DeleteOutlined, HolderOutlined, PlusOutlined, SaveOutlined, TableOutlined,
} from '@ant-design/icons'
import {
  Alert, App, Button, Input, InputNumber, Select, Space, Switch, Table, Tooltip,
} from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { computeWorkProgress } from '../../domain/progress'
import type { Work, WorkKind } from '../../domain/types'
import { DEFAULT_QUANTITY_LABEL, DEFAULT_UNIT } from '../../domain/unit'
import { sumsToOne } from '../../domain/weights'
import { listDecks, type DeckRow } from '../../lib/decksApi'
import { MISSING, formatAreaM2, formatPercent, formatWeight } from '../../lib/format'
import { loadProjectModel } from '../../lib/progressApi'
import { listProjectNames } from '../../lib/projectsApi'
import {
  deleteWork, listWorkDecks, listWorks, saveWorkDecks, saveWorks,
} from '../../lib/worksApi'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from '../../components/FilterBar'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProjectSelect } from '../../components/ProjectSelect'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { searchSelectProps } from '../../components/searchSelect'
import { palette, type, visuallyHidden } from '../../theme'

type ProjectOption = Awaited<ReturnType<typeof listProjectNames>>[number]

/** Helper text, one sentence each, checked against the code (RUL-01). */
const RULES = [
  { id: 'WRK-R2', text: 'Lưu được khi tổng trọng số các công việc tính vào tổng bằng 1.' },
  { id: 'WRK-R2-uncounted', text: 'Công việc không tính vào tổng vẫn có tiến độ riêng nhưng không vào % dự án.' },
  { id: 'WRK-R5', text: 'Lưu sàn tham gia được khi tổng trọng số các sàn tham gia bằng 1.' },
  { id: 'WRK-R5-by-area', text: 'Anh sửa được trọng số sàn mà “Chia theo m²” điền sẵn theo diện tích.' },
  { id: 'WRK-R6', text: 'Công việc nhập tay lấy tiến độ từ con số anh gõ.' },
  { id: 'WRK-R7', text: 'Mỗi công việc dùng một đại lượng và một đơn vị cho mọi sàn của nó.' },
]

/** `works.quantity_label` / `works.unit` (0036): 1–30 characters after trimming. */
const quantityTextOk = (v: string) => v.trim().length >= 1 && v.trim().length <= 30

const KIND_OPTIONS: { value: WorkKind; label: string }[] = [
  { value: 'bays', label: 'Theo ô' },
  { value: 'manual', label: 'Nhập tay' },
]

interface MatrixRow {
  deckId: string
  name: string
  /** In the work when the matrix opened: switched off now, it leaves the work on save. */
  stored: boolean
  totalAreaM2: number
  on: boolean
  weight: number
}

/** Rounds to 4 decimals; the last participating deck takes the remainder so the
 *  shares sum to exactly 1 rather than to 0,9999. */
function sharesByArea(rows: MatrixRow[]): MatrixRow[] {
  const on = rows.filter((r) => r.on)
  const total = on.reduce((sum, r) => sum + r.totalAreaM2, 0)
  if (on.length === 0) return rows
  let assigned = 0
  const weights = new Map<string, number>()
  on.forEach((r, i) => {
    const w = i === on.length - 1
      ? Math.round((1 - assigned) * 10000) / 10000
      : (total > 0 ? Math.round((r.totalAreaM2 / total) * 10000) / 10000 : Math.round((1 / on.length) * 10000) / 10000)
    assigned += w
    weights.set(r.deckId, w)
  })
  return rows.map((r) => (r.on ? { ...r, weight: weights.get(r.deckId) ?? r.weight } : r))
}

/**
 * Công việc: the works a project is paid for, their weights, and which decks
 * each covers at what weight. The one screen that changes the shape of the
 * billed number, so every save asks first.
 */
export function WorksScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [decks, setDecks] = useState<DeckRow[]>([])
  const [draft, setDraft] = useState<Work[]>([])
  const [progressByWork, setProgressByWork] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmingSave, setConfirmingSave] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingWork, setRemovingWork] = useState<Work | null>(null)
  const [removing, setRemoving] = useState(false)
  /** The deck matrix open for one bays work, if any. */
  const [matrix, setMatrix] = useState<{ workId: string; rows: MatrixRow[] } | null>(null)
  const [confirmingMatrix, setConfirmingMatrix] = useState(false)
  const [matrixSaving, setMatrixSaving] = useState(false)
  const dragging = useRef<number | null>(null)
  const { message } = App.useApp()

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listProjectNames()
        setProjects(rows)
        const requested = searchParams.get('project')
        const wanted = rows.some((r) => r.id === requested) ? requested : null
        setProjectId((prev) => prev ?? wanted ?? rows[0]?.id ?? null)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
    // Read once, on mount, like the deck list: this seeds the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(async () => {
    if (!projectId) {
      setDraft([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [works, deckRows, model] = await Promise.all([
        listWorks(projectId), listDecks(projectId), loadProjectModel(projectId),
      ])
      setDraft(works)
      setDecks(deckRows)
      setProgressByWork(Object.fromEntries(model.models.map((m) => [m.work.id, computeWorkProgress(m).progress])))
      setMatrix(null)
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

  const counted = draft.filter((w) => w.counts)
  const sum = counted.reduce((s, w) => s + w.weight, 0)
  const balanced = counted.length === 0 || sumsToOne(counted.map((w) => w.weight))
  const names = draft.map((w) => w.name.trim())
  const namesOk = names.every((n) => n !== '') && new Set(names).size === names.length
  const quantitiesOk = draft.every((w) => quantityTextOk(w.quantityLabel) && quantityTextOk(w.unit))
  const canSave = balanced && namesOk && quantitiesOk && !saving && !loading

  const patch = (i: number, change: Partial<Work>) =>
    setDraft((prev) => prev.map((w, j) => (j === i ? { ...w, ...change } : w)))

  const addWork = () => {
    if (!projectId) return
    setDraft((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        projectId,
        seq: prev.length + 1,
        name: '',
        kind: 'bays',
        weight: 0,
        counts: true,
        manualProgress: 0,
        quantityLabel: DEFAULT_QUANTITY_LABEL,
        unit: DEFAULT_UNIT,
      },
    ])
  }

  const dropOn = (target: number) => {
    const from = dragging.current
    dragging.current = null
    if (from === null || from === target) return
    setDraft((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(target, 0, moved)
      return next.map((w, i) => ({ ...w, seq: i + 1 }))
    })
  }

  const save = async () => {
    if (!projectId) return
    setConfirmingSave(false)
    setSaving(true)
    try {
      await saveWorks(projectId, draft.map((w) => ({ ...w, name: w.name.trim() })))
      message.success('Đã lưu công việc')
      await refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!removingWork) return
    setRemoving(true)
    try {
      await deleteWork(removingWork.id)
      setRemovingWork(null)
      message.success(`Đã xóa công việc ${removingWork.name}`)
      await refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setRemoving(false)
    }
  }

  const openMatrix = async (work: Work) => {
    try {
      const current = await listWorkDecks(work.id)
      const byDeck = new Map(current.map((r) => [r.deckId, r.weight]))
      setMatrix({
        workId: work.id,
        rows: decks.map((d) => ({
          deckId: d.id,
          name: d.name,
          totalAreaM2: d.totalAreaM2,
          on: byDeck.has(d.id),
          stored: byDeck.has(d.id),
          weight: byDeck.get(d.id) ?? 0,
        })),
      })
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const matrixOn = matrix?.rows.filter((r) => r.on) ?? []
  const matrixRemoved = matrix?.rows.filter((r) => r.stored && !r.on) ?? []
  const matrixBalanced = matrixOn.length === 0 || sumsToOne(matrixOn.map((r) => r.weight))

  const saveMatrix = async () => {
    if (!matrix) return
    setConfirmingMatrix(false)
    setMatrixSaving(true)
    const { workId } = matrix
    const saved = new Set(matrixOn.map((r) => r.deckId))
    try {
      await saveWorkDecks(workId, matrixOn.map((r) => ({ deckId: r.deckId, weight: r.weight })))
      // What is stored is now what was saved. The re-read below closes the
      // matrix; when it fails the matrix stays open, and its next save must
      // name the decks leaving the work as it stands now, not at opening (I6).
      setMatrix((m) => (m && m.workId === workId
        ? { ...m, rows: m.rows.map((r) => ({ ...r, stored: saved.has(r.deckId) })) }
        : m))
      message.success('Đã lưu sàn tham gia')
      await refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setMatrixSaving(false)
    }
  }

  const matrixWork = matrix ? draft.find((w) => w.id === matrix.workId) : undefined

  return (
    <>
      <PageHeader
        title="Công việc"
        filters={
          <FilterBar>
            <ProjectSelect
              projects={projects}
              value={projectId}
              onChange={(v) => {
                setProjectId(v)
                setSearchParams({ project: v }, { replace: true })
              }}
            />
          </FilterBar>
        }
        extra={
          <Space size={12}>
            <Button icon={<PlusOutlined aria-hidden />} disabled={!projectId || loading} onClick={addWork}>
              Thêm công việc
            </Button>
            <Tooltip
              title={canSave
                ? 'Lưu danh sách công việc'
                : 'Tên không được trống hoặc trùng, đại lượng và đơn vị từ 1 đến 30 ký tự, và tổng trọng số tính vào tổng phải bằng 1'}
            >
              <Button
                type="primary"
                icon={<SaveOutlined aria-hidden />}
                disabled={!canSave}
                loading={saving}
                onClick={() => setConfirmingSave(true)}
              >
                Lưu công việc
              </Button>
            </Tooltip>
          </Space>
        }
      />
      <PageBody>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        <SectionCard
          title="Công việc của dự án"
          // The sum is a fact of the list like the counts, amber while it is not 1 (M5, HLT-01).
          facts={[
            { value: draft.length, label: 'công việc' },
            { value: counted.length, label: 'tính vào tổng' },
            { prefix: 'Σ trọng số', value: formatWeight(sum), ...(balanced ? {} : { tone: 'warning' as const }) },
          ]}
          bodyPadding={0}
          footer={<RulesDisclosure rules={RULES} />}
        >
          <Table<Work>
            rowKey="id"
            size="middle"
            loading={loading && draft.length === 0}
            dataSource={draft}
            pagination={false}
            locale={{
              // Nothing to say while the read is in flight: the spinner is the
              // state, and "no work yet" under it read as a verdict on a project
              // that had two works -- seen on a slow link, where the empty
              // state sat on screen for three seconds before the rows landed.
              emptyText: loading ? ' ' : (
                <EmptyState
                  title="Dự án chưa có công việc nào"
                  description="Tiến độ dự án bằng 0 cho tới khi có công việc tính vào tổng. Bấm Thêm công việc để bắt đầu."
                />
              ),
            }}
            scroll={{ x: 'max-content' }}
            onRow={(_row, index) => ({
              draggable: !saving,
              onDragStart: () => { dragging.current = index ?? null },
              onDragOver: (e: { preventDefault: () => void }) => e.preventDefault(),
              onDrop: () => dropOn(index ?? 0),
            })}
            columns={[
              {
                title: <span style={visuallyHidden}>Kéo để sắp xếp</span>,
                key: 'handle',
                align: 'center',
                width: 34,
                render: () => <HolderOutlined style={{ color: palette.textTertiary, cursor: 'grab' }} />,
              },
              { title: 'Thứ tự', dataIndex: 'seq', width: 72, align: 'center' },
              {
                title: 'Tên công việc',
                dataIndex: 'name',
                // Room for "CAM Under Deck Giàn giáo"; the table scrolls sideways
                // rather than clipping it (M18).
                width: 260,
                render: (v: string, _w, i) => (
                  <Input
                    size="small"
                    aria-label="Tên công việc"
                    value={v}
                    placeholder="Ví dụ: Sơn, Tháo giáo, Dọn dẹp"
                    status={v.trim() === '' ? 'error' : undefined}
                    onChange={(e) => patch(i, { name: e.target.value })}
                  />
                ),
              },
              // RV6-34: what the work's numbers measure, and in what unit. Free
              // text (Linh), shared by every deck in the work; the labels every
              // other screen prints for this work are built from these two.
              {
                title: 'Đại lượng',
                dataIndex: 'quantityLabel',
                width: 150,
                render: (v: string, _w, i) => (
                  <Input
                    size="small"
                    aria-label="Đại lượng"
                    value={v}
                    placeholder={DEFAULT_QUANTITY_LABEL}
                    maxLength={30}
                    status={quantityTextOk(v) ? undefined : 'error'}
                    onChange={(e) => patch(i, { quantityLabel: e.target.value })}
                  />
                ),
              },
              {
                title: 'Đơn vị',
                dataIndex: 'unit',
                width: 110,
                render: (v: string, _w, i) => (
                  <Input
                    size="small"
                    aria-label="Đơn vị"
                    value={v}
                    placeholder={DEFAULT_UNIT}
                    maxLength={30}
                    status={quantityTextOk(v) ? undefined : 'error'}
                    onChange={(e) => patch(i, { unit: e.target.value })}
                  />
                ),
              },
              {
                title: 'Loại',
                align: 'center',
                dataIndex: 'kind',
                width: 140,
                render: (v: WorkKind, _w, i) => (
                  <Select<WorkKind>
                    size="small"
                    aria-label="Loại công việc"
                    {...searchSelectProps}
                    value={v}
                    options={KIND_OPTIONS}
                    style={{ width: 120 }}
                    onChange={(kind) => patch(i, { kind })}
                  />
                ),
              },
              {
                title: 'Trọng số',
                align: 'center',
                dataIndex: 'weight',
                width: 120,
                render: (v: number, _w, i) => (
                  <InputNumber
                    size="small"
                    aria-label="Trọng số"
                    value={v}
                    min={0}
                    max={1}
                    style={{ width: 100 }}
                    onChange={(n) => patch(i, { weight: n ?? 0 })}
                  />
                ),
              },
              {
                title: 'Tính vào tổng',
                dataIndex: 'counts',
                width: 130,
                align: 'center',
                render: (v: boolean, _w, i) => (
                  <Switch aria-label="Tính vào tổng" checked={v} onChange={(on) => patch(i, { counts: on })} />
                ),
              },
              {
                title: 'Tiến độ',
                align: 'center',
                key: 'progress',
                width: 150,
                render: (_v, w, i) => (w.kind === 'manual' ? (
                  <InputNumber
                    size="small"
                    aria-label="Tiến độ (%)"
                    value={Math.round(w.manualProgress * 10000) / 100}
                    min={0}
                    max={100}
                    // A suffix, not the addon antd deprecates (M17).
                    suffix="%"
                    style={{ width: 120 }}
                    onChange={(n) => patch(i, { manualProgress: (n ?? 0) / 100 })}
                  />
                ) : (
                  <span style={type.body}>
                    {w.id in progressByWork ? formatPercent(progressByWork[w.id]) : MISSING}
                  </span>
                )),
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 120,
                align: 'center',
                render: (_v, w) => (
                  <Space size={6}>
                    {w.kind === 'bays' && (
                      <Tooltip title="Sàn tham gia và trọng số sàn">
                        <Button
                          size="small"
                          aria-label="Sàn tham gia"
                          icon={<TableOutlined />}
                          onClick={() => void openMatrix(w)}
                        />
                      </Tooltip>
                    )}
                    <Tooltip title="Xóa công việc">
                      <Button
                        size="small"
                        danger
                        aria-label="Xóa công việc"
                        icon={<DeleteOutlined />}
                        onClick={() => setRemovingWork(w)}
                      />
                    </Tooltip>
                  </Space>
                ),
              },
            ]}
          />
        </SectionCard>

        {matrix && matrixWork && (
          <div data-testid={`work-decks-${matrix.workId}`}>
          <SectionCard
            title={`Sàn tham gia · ${matrixWork.name || 'công việc mới'}`}
            facts={[
              { value: `${matrixOn.length} / ${matrix.rows.length}`, label: 'sàn' },
              { prefix: 'Σ trọng số sàn', value: formatWeight(matrixOn.reduce((s, r) => s + r.weight, 0)) },
            ]}
            bodyPadding={0}
            extra={
              <Space size={8}>
                <Button
                  onClick={() => setMatrix((m) => (m ? { ...m, rows: sharesByArea(m.rows) } : m))}
                >
                  Chia theo m²
                </Button>
                <Button
                  type="primary"
                  disabled={!matrixBalanced || matrixSaving}
                  loading={matrixSaving}
                  onClick={() => setConfirmingMatrix(true)}
                >
                  Lưu sàn tham gia
                </Button>
                <Button onClick={() => setMatrix(null)}>Đóng</Button>
              </Space>
            }
          >
            <div>
              <Table<MatrixRow>
                rowKey="deckId"
                size="middle"
                dataSource={matrix.rows}
                // Not paged (UI-06): the weights balance as a set and `Chia theo
                // m²` rewrites every row, so a pager would hide rows the total
                // depends on.
                pagination={false}
                columns={[
                  { title: 'Sàn', dataIndex: 'name' },
                  {
                    title: 'Diện tích (m²)',
                    dataIndex: 'totalAreaM2',
                    align: 'center',
                    render: (v: number) => formatAreaM2(v),
                  },
                  {
                    title: 'Tham gia',
                    dataIndex: 'on',
                    width: 110,
                    align: 'center',
                    render: (v: boolean, r) => (
                      <Switch
                        aria-label={`${r.name} tham gia`}
                        checked={v}
                        onChange={(on) => setMatrix((m) => (m ? {
                          ...m,
                          rows: m.rows.map((x) => (x.deckId === r.deckId ? { ...x, on, weight: on ? x.weight : 0 } : x)),
                        } : m))}
                      />
                    ),
                  },
                  {
                    title: 'Trọng số sàn',
                    align: 'center',
                    dataIndex: 'weight',
                    width: 140,
                    render: (v: number, r) => (
                      <InputNumber
                        size="small"
                        aria-label={`Trọng số ${r.name}`}
                        value={v}
                        min={0}
                        max={1}
                        disabled={!r.on}
                        style={{ width: 110 }}
                        onChange={(n) => setMatrix((m) => (m ? {
                          ...m,
                          rows: m.rows.map((x) => (x.deckId === r.deckId ? { ...x, weight: n ?? 0 } : x)),
                        } : m))}
                      />
                    ),
                  },
                ]}
              />
            </div>
          </SectionCard>
          </div>
        )}
      </PageBody>

      <ConsequenceModal
        open={confirmingSave}
        tone="accent"
        tag="Xác nhận"
        title="Lưu công việc?"
        description="Lưu các công việc sau:"
        consequences={['Tiến độ dự án và báo cáo tính lại theo trọng số mới']}
        items={draft.map((w) => ({
          label: w.name.trim() || '(chưa đặt tên)',
          meta: w.counts ? `trọng số ${formatWeight(w.weight)}` : 'không tính vào tổng',
        }))}
        okText="Lưu"
        confirmLoading={saving}
        onCancel={() => setConfirmingSave(false)}
        onOk={() => void save()}
      />

      <ConsequenceModal
        open={confirmingMatrix}
        tone="accent"
        tag="Xác nhận"
        title="Lưu sàn tham gia?"
        description="Lưu các sàn tham gia sau:"
        // The decks that leave are rows too, and only then is their loss said (RUL-01).
        consequences={matrixRemoved.length > 0 ? ['Sàn bị bỏ ra khỏi công việc mất lớp sơn và vị trí ô của công việc đó'] : undefined}
        items={[
          ...matrixOn.map((r) => ({ label: r.name, meta: `trọng số ${formatWeight(r.weight)}` })),
          ...matrixRemoved.map((r) => ({ label: r.name, meta: 'bỏ ra' })),
        ]}
        okText="Lưu"
        confirmLoading={matrixSaving}
        onCancel={() => setConfirmingMatrix(false)}
        onOk={() => void saveMatrix()}
      />

      <ConsequenceModal
        open={removingWork !== null}
        tone="danger"
        tag="Thao tác phá huỷ"
        title={`Xóa công việc ${removingWork?.name ?? ''}?`}
        description="Mất vĩnh viễn theo công việc:"
        items={[
          { label: 'Sàn tham gia và trọng số sàn' },
          { label: 'Lớp sơn của công việc này trên mọi sàn' },
          { label: 'Vị trí và ghi chú của từng ô cho công việc này' },
          { label: 'Zone lập trên các lớp đó' },
        ]}
        consequences={['Không khôi phục được', 'Lịch sử cập nhật vẫn giữ tên công việc này']}
        okText="Xóa công việc"
        confirmText={removingWork?.name}
        confirmLoading={removing}
        onCancel={() => setRemovingWork(null)}
        onOk={() => void remove()}
      />
    </>
  )
}
