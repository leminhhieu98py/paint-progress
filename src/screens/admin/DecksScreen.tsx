import {
  ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined, CopyOutlined, DeleteOutlined,
  DownloadOutlined, PlusOutlined,
} from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Modal, Space, Table, Tooltip, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { computeProjectProgress, summariseDeck } from '../../domain/progress'
import type { WorkKind } from '../../domain/types'
import {
  DEFAULT_QUANTITY_LABEL, DEFAULT_UNIT, labelOfWorks, MIXED_QUANTITY_LABEL, MIXED_UNIT_SUM_TOOLTIP,
  quantityHeading, unitOfWorks,
} from '../../domain/unit'
import { listGsUsers } from '../../lib/adminApi'
import {
  deleteDeck, duplicateDeck, listDecks, swapDeckSeq, type DeckRow,
} from '../../lib/decksApi'
import { formatAreaM2, formatPercent, formatWeight } from '../../lib/format'
import { loadProjectModel } from '../../lib/progressApi'
import type { ProjectModel } from '../../lib/workModel'
import { listProjectNames } from '../../lib/projectsApi'
import { reportFileName } from '../../lib/reportXlsx'
import { buildProjectReport, downloadWorkbook } from '../../lib/projectReport'
import { NEW_DECK } from '../../config'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { modalProps } from '../../components/modalChrome'
import { Donut, type DonutSlice } from '../../components/Donut'
import { ROLLUP_RING, ROLLUP_RING_SIZE, ROLLUP_RING_THICKNESS, ringFigureStep } from '../../components/ringFit'
import { legendRowProps } from '../../components/ringHover'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from '../../components/FilterBar'
import { InfoTip } from '../../components/InfoTip'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProgressBar } from '../../components/ProgressBar'
import { ProjectSelect } from '../../components/ProjectSelect'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { CategoryBadge } from '../../components/CategoryBadge'
import type { CategoryValue } from '../../components/categoryTone'
import { useTablePagination } from '../../components/tablePagination'
import { roundSharesToTotal } from '../../domain/rounding'
import { categoricalColor, palette, space, type } from '../../theme'

interface RollupRow {
  key: string
  name: string
  code: string
  share: string
  totalAreaM2: string
  progress: number
}

/** One work of the project in the table under the decks (DCK-R7). */
interface WorkRow {
  key: string
  name: string
  kind: WorkKind
  weight: string
  counts: boolean
  progress: number
}

const WORK_KIND_LABEL = { bays: 'Theo ô', manual: 'Nhập tay' } as const satisfies Record<WorkKind, CategoryValue<'workKind'>>

const RULES = [
  {
    id: 'DCK-R2',
    text: 'Tỉ trọng của sàn là trọng số hiệu dụng: tổng (trọng số công việc × trọng số sàn trong công việc) qua các công việc có tính vào tổng. Cả hai trọng số đặt ở mục Công việc, không nhập ở đây.',
  },
]

type ProjectOption = Awaited<ReturnType<typeof listProjectNames>>[number]

/**
 * The decks of one project, as a way in and nothing more.
 *
 * Creating a deck and attaching its drawing both used to happen here, in
 * modals over the list. They belong to a deck, and a deck has its own address
 * now: this screen names them and gets out of the way.
 */
export function DecksScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [decks, setDecks] = useState<DeckRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /**
   * Every work of the project with its decks, stages and bay states (0024).
   *
   * This is the project-wide half of what used to be `/admin/progress`. The
   * per-deck half moved into the deck's own screen; the rollup and the export
   * are about the PROJECT, and this list is the only screen that has one
   * selected.
   */
  const [model, setModel] = useState<ProjectModel | null>(null)
  const [exporting, setExporting] = useState(false)
  /** The deck whose deletion is being confirmed, and the write in flight. */
  const [removingDeck, setRemovingDeck] = useState<DeckRow | null>(null)
  /** The deck being duplicated (Feedback Rv2, item 3), while its dialog is open. */
  const [copyingDeck, setCopyingDeck] = useState<DeckRow | null>(null)
  const [copying, setCopying] = useState(false)
  const [copyForm] = Form.useForm<{ name: string; code: string }>()
  const [removing, setRemoving] = useState(false)
  /** A seq swap is in flight: every arrow waits for it (see reorderDeck). */
  const [reordering, setReordering] = useState(false)
  const [confirmingExport, setConfirmingExport] = useState(false)
  const { message } = App.useApp()

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listProjectNames()
        setProjects(rows)
        // Only seed the default once: an explicit later choice must not be
        // clobbered if the project list happens to refresh.
        //
        // `?project=` wins when it names a project that still exists. That is
        // how the projects list hands one over, and falling back to the first
        // would quietly show the admin a different project's decks than the row
        // they clicked. An id that no longer resolves -- a bookmark to a
        // deleted project -- falls back rather than showing an empty screen.
        const requested = searchParams.get('project')
        const wanted = rows.some((r) => r.id === requested) ? requested : null
        setProjectId((prev) => prev ?? wanted ?? rows[0]?.id ?? null)
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
    // Read once, on mount: this seeds the initial choice, and re-running it
    // when the admin's own selection rewrites the query string would fight
    // with that selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshDecks = useCallback(async () => {
    // Clear `loading` before returning, not after. It initialises true so the
    // table spins on first paint, and with no project to load -- an empty
    // project list, or listProjects throwing -- nothing downstream would ever
    // turn it off again: the admin gets a spinner forever instead of an empty
    // state. UsersScreen carries a note about the same failure mode.
    if (!projectId) {
      setDecks([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setDecks(await listDecks(projectId))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refreshDecks()
  }, [refreshDecks])

  useEffect(() => {
    if (!projectId) {
      setModel(null)
      return
    }
    let cancelled = false
    // Not cleared first, deliberately: a failed reload leaves the last good
    // rollup on screen rather than blanking a number the admin was reading.
    loadProjectModel(projectId)
      .then((m) => { if (!cancelled) setModel(m) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [projectId])

  const modelDecks = model?.decks ?? []
  const rollup = useMemo(() => computeProjectProgress(model?.models ?? []), [model])
  /**
   * RV6-36: several works may be in scope here, so the quantity heading is
   * theirs only when they agree. A deck's own unit is that of the bays works
   * it is in (m² when it is in none yet); the heading is that unit when every
   * deck reads the same one, else `Số lượng` with each row naming its own and
   * the Σ refusing to add them.
   */
  const bays = (model?.models ?? []).filter((m) => m.work.kind === 'bays' && m.decks.length > 0)
  const unitOfDeck = (deckId: string): string | null => {
    const inWorks = bays.filter((m) => m.decks.some((e) => e.deck.id === deckId)).map((m) => m.work)
    return inWorks.length === 0 ? DEFAULT_UNIT : unitOfWorks(inWorks)
  }
  /**
   * The heading, the Σ's unit and the cell rule for ONE set of decks. The deck
   * list and the rollup each derive their own, because the rollup lists only
   * the weighted decks: a deck in no work is m² in the list yet absent from
   * the rollup, whose rows may then all agree on a unit the list cannot.
   */
  const quantityScope = (deckIds: string[]) => {
    const units = deckIds.map(unitOfDeck)
    const works = bays.filter((m) => m.decks.some((e) => deckIds.includes(e.deck.id))).map((m) => m.work)
    const unit = units.length === 0
      ? DEFAULT_UNIT
      : (units.every((u) => u !== null && u === units[0]) ? units[0] : null)
    const label = works.length === 0
      ? DEFAULT_QUANTITY_LABEL
      : (labelOfWorks(works) ?? MIXED_QUANTITY_LABEL)
    const title = unit === null ? MIXED_QUANTITY_LABEL : quantityHeading(label, unit)
    /** The figure, with the row's own unit only when the heading could not carry one. */
    const cell = (deckId: string, n: number): string => {
      if (unit !== null) return formatAreaM2(n)
      const own = unitOfDeck(deckId)
      return own === null ? formatAreaM2(n) : `${formatAreaM2(n)} ${own}`
    }
    return { unit, title, cell }
  }
  const listScope = quantityScope(modelDecks.map((d) => d.id))
  /**
   * Each deck across its works: P_d, and the weight it carries in P, which is
   * Σ W·D over the counted bays works it is in -- no longer its m² share. A
   * deck in no work is still listed, at zero, so nothing the project has goes
   * missing from the one screen that lists it.
   */
  const summaries = useMemo(
    () => (model ? model.decks.map((d) => summariseDeck(d.id, model.models)) : []),
    [model],
  )

  const carriesWeight = (i: number) => (summaries[i]?.effectiveWeight ?? 0) > 0
  /** Over the decks the rollup actually lists -- see `carriesWeight` below. */
  const rollupScope = quantityScope(modelDecks.filter((_, i) => carriesWeight(i)).map((d) => d.id))

  const rollupRows: RollupRow[] = modelDecks.map((deck, i) => ({
    key: deck.id,
    name: deck.name,
    code: deck.code,
    share: formatPercent(summaries[i]?.effectiveWeight ?? 0),
    totalAreaM2: rollupScope.cell(deck.id, deck.totalAreaM2),
    progress: summaries[i]?.progress ?? 0,
  }))
  /**
   * Feedback Rv2, item 4: a deck in no counted work weighs nothing in P, and a
   * row that will read 0,00% for ever is noise in the one table that says how
   * the project is going. It is hidden here, not removed: the Sàn list above
   * says what exists, the works table says what counts, and one line under
   * this table says how many rows it is not showing.
   *
   * Feedback Rv5, items 1 and 3: the ring and `Tổng dự án` follow the same
   * predicate. Rv2 left both alone on the reasoning that "the ring already
   * gets nothing from a zero weight" -- true of the arc, false of the legend,
   * which went on listing eleven decks with six of them at 0,00%. And the m²
   * total summed every deck of the project under a table of only the weighted
   * ones: 194.525,00 over a visible 160.229,00. One predicate, so the three
   * cannot drift apart again.
   */
  const visibleRollup = rollupRows.filter((_, i) => carriesWeight(i))
  const hiddenDecks = rollupRows.length - visibleRollup.length
  const workRows: WorkRow[] = rollup.works.map((w) => ({
    key: w.work.id,
    name: w.work.name,
    kind: w.work.kind,
    weight: formatWeight(w.work.weight),
    counts: w.work.counts,
    progress: w.progress,
  }))
  // Switching project is re-aiming the same screen: both tables start again at page 1.
  const rollupPagination = useTablePagination(visibleRollup.length, projectId)
  const workPagination = useTablePagination(workRows.length, projectId)
  /** What the decks carry of P; the rest sits in manual works. */
  const effectiveTotal = summaries.reduce((sum, d) => sum + d.effectiveWeight, 0)

  /*
    Each slice's ARC is a weight TIMES a progress -- what it actually
    contributes to the project number -- not a progress alone: a deck's
    effective weight times its tổng hợp, then a counted manual work's weight
    times its figure. The slices therefore sum to exactly P, and the ring's
    empty part is the work left. A ring of raw percentages would sum to
    something meaningless and read as though the project were further along.

    The LEGEND number beside a slice is different (RV6-02): `display` carries
    the deck's (or work's) own progress -- the same figure the rollup table's
    `Tiến độ` column reads for it -- so a person comparing the legend to the
    table sees one number, not the arc's contribution. `display` is optional
    on `DonutSlice`; the legend prints `display ?? value`.
  */
  const parts = [
    ...modelDecks.flatMap((deck, i) => (carriesWeight(i) ? [{
      key: deck.id,
      label: deck.code, // RV6-01: a deck slice is labelled by code, not name.
      value: (summaries[i]?.effectiveWeight ?? 0) * (summaries[i]?.progress ?? 0),
      display: summaries[i]?.progress ?? 0,
    }] : [])),
    ...rollup.works
      .filter((w) => w.work.kind === 'manual' && w.work.counts)
      .map((w) => ({
        key: w.work.id,
        // A work has no code, so a manual-work slice keeps its name.
        label: w.work.name,
        value: w.work.weight * w.progress,
        display: w.progress,
      })),
  ]
  /**
   * The contribution column as printed (RV6-40): rounded so the column adds up
   * to the centre figure to the last digit, and `Còn lại` is the printed
   * complement -- a reader checks this column by adding it up.
   */
  const shownShares = roundSharesToTotal(parts.map((sl) => sl.value), rollup.progress)
  /*
    A colour of its own per slice (CHT-01), in legend order, so six decks no
    longer read as three repeated teals. The tooltip's figures are the two the
    legend row prints -- the shown share, not a recomputed one.
  */
  const slices: DonutSlice[] = parts.map((sl, i) => ({
    ...sl,
    color: categoricalColor(i),
    detail: `Tiến độ ${formatPercent(sl.display)} · Đóng góp ${formatPercent(shownShares[i])}`,
  }))
  const shownRemainder = 1 - roundSharesToTotal([rollup.progress], rollup.progress)[0]
  const totalArea = modelDecks.reduce((sum, d, i) => (carriesWeight(i) ? sum + d.totalAreaM2 : sum), 0)

  /**
   * Hard delete, behind the typed name (Feedback Rv1, item 1). The row goes
   * with everything under it; the drawing file is cleaned up after, and a
   * file that would not go is reported rather than treated as a failed delete
   * -- see decksApi.deleteDeck for the order and why.
   */
  /**
   * Row, guides, cells and the drawing file, as one new deck in this project
   * -- and nothing recorded on it. The copy opens straight away: the next
   * thing the admin does is add it to a work, and that is on the deck's page.
   */
  const copyDeck = async ({ name, code }: { name: string; code: string }) => {
    if (!copyingDeck) return
    setCopying(true)
    try {
      const { deckId, drawingCopied } = await duplicateDeck(
        { id: copyingDeck.id, projectId: copyingDeck.projectId, imagePath: copyingDeck.imagePath },
        { name: name.trim(), code: code.trim() },
      )
      setCopyingDeck(null)
      message.success(`Đã nhân bản sàn ${copyingDeck.name}`)
      if (!drawingCopied) {
        message.warning('Đã nhân bản, nhưng chưa sao chép được bản vẽ. Tải bản vẽ lên sàn mới như thường.')
      }
      navigate(deckId)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCopying(false)
    }
  }

  const removeDeck = async () => {
    if (!removingDeck) return
    setRemoving(true)
    try {
      const { drawingRemoved } = await deleteDeck({
        id: removingDeck.id, imagePath: removingDeck.imagePath,
      })
      setRemovingDeck(null)
      message.success(`Đã xóa sàn ${removingDeck.name}`)
      if (!drawingRemoved) {
        message.warning('Đã xóa, nhưng chưa dọn được file bản vẽ trên kho lưu trữ')
      }
      // Re-read rather than patch: what is shown is what is there. Both
      // lists, because the rollup below the table names the deck too.
      await refreshDecks()
      if (projectId) setModel(await loadProjectModel(projectId))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setRemoving(false)
    }
  }

  /**
   * Swap a deck's `seq` with its neighbour in the current list order (RV6-05).
   * Order everywhere else -- the rollup table, the donut legend, GS deck
   * tabs, the KPI plan table, the xlsx -- already follows `seq`, so this one
   * write moves the deck everywhere at once. Not transactional
   * (decksApi.swapDeckSeq): a failure between the two writes leaves both
   * decks at one seq, which this list still renders (ties keep insertion
   * order) and the next swap repairs.
   *
   * One at a time: a second click before `refreshDecks` lands would swap
   * from the seqs this render still holds, not the ones just written.
   */
  const reorderDeck = async (a: DeckRow, b: DeckRow | undefined) => {
    if (!b || reordering) return
    setReordering(true)
    try {
      await swapDeckSeq({ id: a.id, seq: a.seq }, { id: b.id, seq: b.seq })
      await refreshDecks()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setReordering(false)
    }
  }

  /**
   * The XLSX (spec §9), built from EVERY deck of the project.
   *
   * Zones and pictures are fetched here rather than held all the time: export is
   * a rare action, and a round trip and a canvas decode per deck on a button
   * pressed once a week is cheaper than paying for them on every screen open.
   */
  const exportReport = async () => {
    if (!projectId || !model || modelDecks.length === 0) return
    setConfirmingExport(false)
    setExporting(true)
    try {
      const profiles = await listGsUsers().catch(() => [])
      const project = projects.find((p) => p.id === projectId)
      const blob = await buildProjectReport({
        projectName: project?.name ?? '',
        projectCode: project?.code ?? '',
        model,
        // Attribution only; a failed names read must not fail the file.
        userNames: Object.fromEntries(profiles.map((u) => [u.id, u.fullName])),
      })
      downloadWorkbook(blob, reportFileName(project?.code ?? 'export', dayjs().format('YYYY-MM-DD')))
      message.success('Đã xuất báo cáo')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Sàn"
        filters={
          <FilterBar>
            <ProjectSelect
              projects={projects}
              value={projectId}
              onChange={(v) => {
                setProjectId(v)
                // Replace, not push: switching projects is re-aiming the same
                // screen, and Back should leave the decks list rather than walk
                // the admin through every project they looked at.
                setSearchParams({ project: v }, { replace: true })
              }}
            />
          </FilterBar>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            disabled={!projectId}
            onClick={() => navigate(`${NEW_DECK}?project=${projectId}`)}
          >
            Tạo sàn
          </Button>
        }
      />

      <PageBody>
        {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

        <SectionCard bodyPadding={0}>
          <Table<DeckRow>
            rowKey="id"
            loading={loading}
            dataSource={decks}
            pagination={false}
            // Sized to its content, as StageSpecTable is (QA F8): every
            // other column has a fixed width, so at 1024px the name was left
            // ~66px and "Otis Test Deck" wrapped to three lines under a
            // two-line header. Now the card scrolls sideways instead.
            scroll={{ x: 'max-content' }}
            locale={{
              emptyText: (
                <EmptyState title="Dự án này chưa có sàn nào" />
              ),
            }}
            columns={[
              {
                title: 'Tên sàn',
                dataIndex: 'name',
                render: (v: string) => <span style={type.body}>{v}</span>,
              },
              { title: 'Mã', dataIndex: 'code', width: 120 },
              { title: 'Số ô', dataIndex: 'cellCount', width: 90, align: 'center' },
              {
                title: listScope.title,
                dataIndex: 'totalAreaM2',
                width: 160,
                align: 'center',
                render: (v: number, deck) => listScope.cell(deck.id, v),
              },
              {
                title: 'Bản vẽ',
                align: 'center',
                key: 'drawing',
                width: 130,
                render: (_v, deck) => (
                  <CategoryBadge category="drawing" value={deck.imagePath ? 'Đã có' : 'Chưa có'} />
                ),
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 170,
                // Pinned: the list scrolls sideways below ~1100px (QA F8) and
                // the row's actions must not scroll out of the card with it.
                fixed: 'right',
                align: 'center',
                render: (_v, deck) => (
                  <Space size={6}>
                    <Tooltip title="Mở sàn">
                      <Button
                        size="small"
                        aria-label="Mở"
                        icon={<ArrowRightOutlined />}
                        onClick={() => navigate(deck.id)}
                      />
                    </Tooltip>
                    <Tooltip title="Nhân bản sàn · bản vẽ, khung và lưới ô">
                      <Button
                        size="small"
                        aria-label="Nhân bản sàn"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          copyForm.setFieldsValue({ name: `${deck.name} (bản sao)`, code: `${deck.code}-2` })
                          setCopyingDeck(deck)
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="Xóa sàn">
                      <Button
                        size="small"
                        danger
                        aria-label="Xóa sàn"
                        icon={<DeleteOutlined />}
                        onClick={() => setRemovingDeck(deck)}
                      />
                    </Tooltip>
                  </Space>
                ),
              },
              {
                title: 'Thứ tự',
                key: 'reorder',
                width: 90,
                fixed: 'right',
                align: 'center',
                // Order everywhere else follows `seq`, i.e. this list's own
                // order (`listDecks` already sorts by it) -- so the row
                // before/after in `decks` IS the neighbour to swap with.
                render: (_v, deck, index) => (
                  <Space size={2}>
                    <Tooltip title="Lên">
                      <Button
                        size="small"
                        aria-label="Lên"
                        icon={<ArrowUpOutlined />}
                        disabled={index === 0 || reordering}
                        onClick={() => void reorderDeck(deck, decks[index - 1])}
                      />
                    </Tooltip>
                    <Tooltip title="Xuống">
                      <Button
                        size="small"
                        aria-label="Xuống"
                        icon={<ArrowDownOutlined />}
                        disabled={index === decks.length - 1 || reordering}
                        onClick={() => void reorderDeck(deck, decks[index + 1])}
                      />
                    </Tooltip>
                  </Space>
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Tiến độ toàn dự án"
          bodyPadding={0}
          footer={<RulesDisclosure rules={RULES} />}
          extra={
            <Tooltip title={modelDecks.length === 0 ? 'Cần ít nhất một sàn' : 'Xuất báo cáo · .xlsx'}>
              <Button
                icon={<DownloadOutlined aria-hidden />}
                onClick={() => setConfirmingExport(true)}
                loading={exporting}
                disabled={modelDecks.length === 0}
              >
                Xuất báo cáo
              </Button>
            </Tooltip>
          }
        >
          {modelDecks.length === 0 ? (
            <EmptyState title="Dự án này chưa có sàn nào" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 400px)' }}>
              {/*
                The table and the ring get separate ids. Every deck name appears
                in both, so one id over the pair makes a scoped query ambiguous
                -- and a test that cannot say which half it is reading is a test
                that passes when one half is empty.
              */}
              <div style={{ borderRight: `1px solid ${palette.borderCard}`, minWidth: 0 }}>
                <div data-testid="project-rollup">
                <Table<RollupRow>
                  size="small"
                  pagination={rollupPagination}
                  dataSource={visibleRollup}
                  columns={[
                    { title: 'Sàn', dataIndex: 'name', key: 'name' },
                    { title: 'Mã', dataIndex: 'code', key: 'code', width: 100 },
                    { title: 'Tỉ trọng', dataIndex: 'share', key: 'share', width: 110, align: 'center' },
                    {
                      title: rollupScope.title,
                      dataIndex: 'totalAreaM2',
                      key: 'totalAreaM2',
                      width: 150,
                      align: 'center',
                    },
                    {
                      title: 'Tiến độ',
                      align: 'center',
                      dataIndex: 'progress',
                      key: 'progress',
                      width: 220,
                      render: (v: number) => <ProgressBar ratio={v} />,
                    },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0}>
                        <span style={type.bodyStrong}>Tổng dự án</span>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} />
                      <Table.Summary.Cell index={2} align="center">
                        <span style={type.bodyStrong}>{formatPercent(effectiveTotal)}</span>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="center">
                        {rollupScope.unit === null ? (
                          <Tooltip title={MIXED_UNIT_SUM_TOOLTIP}>
                            <span style={type.bodyStrong}>—</span>
                          </Tooltip>
                        ) : (
                          <span style={type.bodyStrong}>{formatAreaM2(totalArea)}</span>
                        )}
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="center">
                        <ProgressBar ratio={rollup.progress} height={8} />
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
                {hiddenDecks > 0 && (
                  <Typography.Text
                    type="secondary"
                    style={{ display: 'block', ...type.caption, padding: `${space.sm}px ${space.xl}px ${space.md}px` }}
                  >
                    {`Đã ẩn ${hiddenDecks} sàn có tỉ trọng 0,00%`}
                    <InfoTip text="Không thuộc công việc nào tính vào tổng" />
                  </Typography.Text>
                )}
                </div>

                {/*
                  The works, because the deck weights above are a product of
                  theirs and P is a sum over them: a manual work (giấy tờ, xà
                  lan) shows up nowhere else on this screen, yet it is in P.
                */}
                <div
                  data-testid="project-works"
                  // A hairline between the two tables and nothing else: the
                  // table's own first header says `Công việc`, and a label
                  // above it saying the same read as a second heading (TBL-03).
                  style={{ borderTop: `1px solid ${palette.borderSplit}` }}
                >
                  <Table<WorkRow>
                    size="small"
                    pagination={workPagination}
                    dataSource={workRows}
                    columns={[
                      { title: 'Công việc', dataIndex: 'name', key: 'name' },
                      {
                        title: 'Loại',
                        align: 'center',
                        dataIndex: 'kind',
                        key: 'kind',
                        width: 100,
                        render: (k: WorkKind) => <CategoryBadge category="workKind" value={WORK_KIND_LABEL[k]} />,
                      },
                      { title: 'Trọng số', dataIndex: 'weight', key: 'weight', width: 110, align: 'center' },
                      {
                        title: 'Tính vào tổng',
                        align: 'center',
                        dataIndex: 'counts',
                        key: 'counts',
                        width: 150,
                        render: (c: boolean) => <CategoryBadge category="counts" value={c ? 'Có' : 'Không'} />,
                      },
                      {
                        title: 'Tiến độ',
                        align: 'center',
                        dataIndex: 'progress',
                        key: 'progress',
                        width: 220,
                        render: (v: number) => <ProgressBar ratio={v} />,
                      },
                    ]}
                    summary={() => (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0}>
                          <span style={type.bodyStrong}>Tổng dự án</span>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="center" />
                        <Table.Summary.Cell index={2} align="center">
                          <span style={type.bodyStrong}>
                            {formatWeight(rollup.works
                              .filter((w) => w.work.counts)
                              .reduce((sum, w) => sum + w.work.weight, 0))}
                          </span>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="center" />
                        <Table.Summary.Cell index={4} align="center">
                          <ProgressBar ratio={rollup.progress} height={8} />
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    )}
                  />
                </div>
              </div>

              <div
                data-testid="rollup-donut"
                // Top padding equal to the small table's header cell padding,
                // so `Tiến độ dự án` sits on the line of `Sàn` across the
                // divider rather than a text line below it (UX-02).
                style={{ padding: `${space.sm}px ${space.xl}px ${space.xl}px`, background: palette.bgSubtle }}
              >
                <div style={{ ...type.label, color: palette.textTertiary }}>
                  Tiến độ dự án
                </div>
                <ProjectRing
                  slices={slices}
                  shownShares={shownShares}
                  shownRemainder={shownRemainder}
                  progress={rollup.progress}
                />
              </div>
            </div>
          )}
        </SectionCard>
      </PageBody>

      <ConsequenceModal
        open={confirmingExport}
        tag="Xác nhận"
        title="Xuất báo cáo dự án?"
        items={modelDecks.map((d) => ({
          label: d.name,
          meta: `${d.cellCount} ô`,
        }))}
        consequence="Có thể mất một lúc với dự án nhiều sàn."
        okText="Xuất"
        confirmLoading={exporting}
        onCancel={() => setConfirmingExport(false)}
        onOk={() => void exportReport()}
      />

      <Modal
        open={copyingDeck !== null}
        title={`Nhân bản sàn «${copyingDeck?.name ?? ''}»`}
        onCancel={() => setCopyingDeck(null)}
        {...modalProps}
        footer={[
          <Button key="cancel" onClick={() => setCopyingDeck(null)}>Huỷ</Button>,
          <Button key="ok" type="primary" loading={copying} onClick={() => copyForm.submit()}>
            Nhân bản
          </Button>,
        ]}
      >
        <Typography.Paragraph type="secondary" style={{ ...type.caption, marginTop: 0 }}>
          Sao chép bản vẽ, khung và lưới ô. Không sao chép công việc, lớp sơn, tiến độ hay kế hoạch.
        </Typography.Paragraph>
        <Form form={copyForm} layout="vertical" onFinish={(v) => void copyDeck(v)}>
          <Form.Item name="name" label="Tên sàn mới" rules={[{ required: true, message: 'Đặt tên sàn' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="code"
            label="Mã sàn mới"
            rules={[
              { required: true, message: 'Đặt mã sàn' },
              {
                validator: (_r, value: string) =>
                  decks.some((d) => d.code.toLowerCase() === (value ?? '').trim().toLowerCase())
                    ? Promise.reject(new Error('Mã sàn đã dùng trong dự án này'))
                    : Promise.resolve(),
              },
            ]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <ConsequenceModal
        open={removingDeck !== null}
        tone="danger"
        tag="Thao tác phá huỷ"
        title={`Xóa sàn ${removingDeck?.name ?? ''}?`}
        description="Xóa vĩnh viễn, không khôi phục được. Mất theo sàn:"
        items={[
          { label: 'Toàn bộ ô và lịch sử công đoạn', meta: removingDeck ? `${removingDeck.cellCount} ô` : undefined },
          { label: 'Zone và kế hoạch' },
          { label: 'Ghi chú của GS' },
          { label: 'Bản vẽ đã tải lên', meta: removingDeck?.imagePath ? 'Đã có' : 'Chưa có' },
        ]}
        consequence="Máy tính bảng đang mở sàn này sẽ không ghi được nữa cho tới khi tải lại."
        okText="Xóa sàn"
        confirmText={removingDeck?.name}
        confirmLoading={removing}
        onCancel={() => setRemovingDeck(null)}
        onOk={() => void removeDeck()}
      />
    </>
  )
}

/**
 * The project ring and its legend, with the slice under the pointer or focus
 * (CHT-02). Its own component so that hovering re-renders the ring and the
 * legend, not the whole screen and its tables (m-4).
 */
function ProjectRing({
  slices,
  shownShares,
  shownRemainder,
  progress,
}: {
  slices: DonutSlice[]
  /** The contribution column as printed (RV6-40). */
  shownShares: number[]
  /** `Còn lại`, the printed complement of the centre figure. */
  shownRemainder: number
  /** P, the centre figure. */
  progress: number
}) {
  const [active, setActive] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
      <Donut
        label="Tiến độ dự án"
        slices={slices}
        size={ROLLUP_RING_SIZE}
        thickness={ROLLUP_RING_THICKNESS}
        activeKey={active}
        onActiveChange={setActive}
      >
        {/* The largest step that fits the hole, down to bodyStrong (I-2). */}
        <span
          data-testid="ring-figure"
          style={{
            ...ringFigureStep(formatPercent(progress), [type.displaySm, type.cardTitle, type.bodyStrong], ROLLUP_RING),
            letterSpacing: '-0.028em',
          }}
        >
          {formatPercent(progress)}
        </span>
        <span style={{ ...type.caption, color: palette.textTertiary, marginTop: 3 }}>
          toàn dự án
        </span>
      </Donut>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
        {/*
          Two numbers per row (RV6-40, Linh's review of v1.7.0). RV6-02
          put the deck's own progress here so the legend agreed with
          the table; she then read `83,22%` beside an arc a fifth of
          the ring and asked why the five numbers do not add up to the
          centre. They never did -- the arc is weight × progress -- so
          that figure now stands beside the progress, in its own column,
          and the header says which is which. The contribution column
          sums to P exactly; the progress column is the table's.
        */}
        <div style={{ ...type.caption, color: palette.textTertiary, textAlign: 'right' }}>
          Tiến độ · Đóng góp
        </div>
        {slices.map((sl, i) => (
          <div
            key={sl.key}
            data-testid="legend-row"
            {...legendRowProps(sl.key ?? sl.label, active, setActive, {
              display: 'flex', alignItems: 'center', gap: 9,
            })}
          >
            <span
              data-testid="legend-marker"
              style={{
                width: 11, height: 11, borderRadius: '50%', flex: 'none', background: sl.color,
              }}
            />
            <span
              style={{
                ...type.body, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {sl.label}
            </span>
            <span
              style={{
                marginLeft: 'auto', width: 56, textAlign: 'right', flex: 'none',
                ...type.body, color: palette.textSecondary,
              }}
            >
              {formatPercent(sl.display ?? sl.value)}
            </span>
            <span style={{ width: 56, textAlign: 'right', flex: 'none', ...type.bodyStrong }}>
              {formatPercent(shownShares[i])}
            </span>
          </div>
        ))}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 9, paddingTop: 8,
            borderTop: `1px solid ${palette.borderSplit}`, marginTop: 2,
          }}
        >
          <span
            style={{
              width: 11, height: 11, borderRadius: '50%', flex: 'none', background: palette.track,
            }}
          />
          <span style={{ ...type.body, color: palette.textTertiary }}>
            Còn lại
          </span>
          <span
            style={{
              marginLeft: 'auto', width: 56, textAlign: 'right', flex: 'none',
              ...type.bodyStrong, color: palette.textTertiary,
            }}
          >
            {formatPercent(shownRemainder)}
          </span>
        </div>
      </div>
    </div>
  )
}
