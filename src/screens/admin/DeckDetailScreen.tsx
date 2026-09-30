import { FilePdfOutlined, UploadOutlined, WarningOutlined } from '@ant-design/icons'
import {
  Alert, App, Button, Form, Input, InputNumber, Segmented, Select, Space, Spin, Typography, Upload,
} from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { APP_BASE_PATH, NEW_DECK } from '../../config'
import { listDeckWorks, type DeckWork } from '../../lib/gsApi'
import { EmptyState } from '../../components/EmptyState'
import {
  createDeck, getDeck, listDecks, reprorateDeckCells, updateDeckArea, updateDeckIdentity,
  uploadDrawing, type DeckRow,
} from '../../lib/decksApi'
import { formatAreaM2 } from '../../lib/format'
import { listDeckEvents } from '../../lib/progressApi'
import type { DeckEvent } from '../../domain/types'
import {
  DEFAULT_QUANTITY_LABEL, deckUnitOf, labelOfWorks, MIXED_QUANTITY_LABEL, unitOfWorks,
} from '../../domain/unit'
import { pdfPageCount, renderPdfPage } from '../../lib/pdfToPng'
import { DeckEditor } from './DeckEditor'
import { StageConfigPanel } from './StageConfigPanel'
import { DeckProgressPanel } from './DeckProgressPanel'
import { EffortHistoryPanel } from './EffortHistoryPanel'
import { DeckForecastPanel } from './DeckForecastPanel'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { InfoTip } from '../../components/InfoTip'
import { SectionCard } from '../../components/SectionCard'
import { WORK_SELECT_WIDTH, searchSelectProps, useFullOptionsProps } from '../../components/searchSelect'
import { viAreaInputProps, viIntegerInputProps } from '../../components/viNumberInput'
import { formatPercent } from '../../lib/format'
import { palette, type } from '../../theme'

/** One read-only fact about the deck, in the card grid of panel A3.1. */
function IdentityCard({
  label,
  value,
  sub,
  tip,
}: {
  label: string
  value: string
  sub?: string
  /** What the figure means, on the label's (?) (CPY-02). */
  tip?: string
}) {
  return (
    <div
      style={{
        background: palette.bgSubtle,
        border: `1px solid ${palette.borderSplit}`,
        borderRadius: 11,
        padding: '14px 16px 16px',
      }}
    >
      <div style={{ ...type.label, color: palette.textTertiary }}>
        {label}
        {tip !== undefined && <InfoTip text={tip} />}
      </div>
      {/* One size for every value, and a long code or file name wraps where it
          must rather than mid-word everywhere (M4). */}
      <div style={{ marginTop: 9, ...type.cardTitle, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
        {value}
      </div>
      {sub !== undefined && (
        <div style={{ marginTop: 4, ...type.caption, lineHeight: 1.4, color: palette.textTertiary }}>
          {sub}
        </div>
      )}
    </div>
  )
}

/**
 * One deck, at its own address.
 *
 * The deck used to open as a panel over the list, which meant a reload lost it,
 * a link could not name it and the browser's Back went to the projects screen
 * rather than out of the deck. The id is in the URL now, so all three work.
 *
 * Three states, not two: creating (no deck yet), viewing (read-only, with the
 * way into editing) and editing. Creating and editing share the same form --
 * the fields are the same, and a screen that grew a second copy of them would
 * be a screen where they could disagree.
 */
export function DeckDetailScreen() {
  const { deckId } = useParams<{ deckId: string }>()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const creating = deckId === NEW_DECK

  const [deck, setDeck] = useState<DeckRow | null>(null)
  const [loading, setLoading] = useState(!creating)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(creating)
  const [saving, setSaving] = useState(false)
  /**
   * True while the save is waiting to be read back.
   *
   * Only raised when the write would do something the form does not show: swap
   * the sheet the bays are traced against, or move the denominator every
   * percentage on the deck is divided by. A rename goes straight through --
   * asking about a rename is what teaches an admin to click through the two
   * above.
   */
  const [confirmingSave, setConfirmingSave] = useState(false)
  const { message } = App.useApp()

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [area, setArea] = useState(0)
  /**
   * The PDF waiting to be rendered, and which page of it.
   *
   * PDF only. A drawing that arrives as a photo or a screenshot has already
   * lost the dashed beam centrelines detection reads, and no message afterwards
   * explains why the deck came back with a tenth of its bays.
   */
  const [pdf, setPdf] = useState<File | null>(null)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const uploadWrapRef = useRef<HTMLDivElement>(null)

  /*
    antd deletes `id` from the props it hands rc-upload (upload/Upload.js:331)
    and puts it on the wrapper instead, so the real <input type=file> ends up
    with no id and no label pointing at it -- no accessible name at all. On the
    one control that attaches a deck's drawing, that is not a name worth losing.

    Set here rather than worked around in the tests, because a test that
    reaches the input by tag name would be agreeing that it has no name.
  */
  useEffect(() => {
    const input = uploadWrapRef.current?.querySelector('input[type="file"]')
    input?.setAttribute('aria-label', 'Bản vẽ (PDF)')
  })
  /**
   * The deck's own percentage, for the header.
   *
   * Reported up by the progress panel rather than fetched again here: that
   * panel already loads every cell and every stage of this deck to draw them,
   * and a second read of the same payload for one number is the heaviest query
   * on the screen run twice.
   */
  const [progress, setProgress] = useState<number | null>(null)
  /**
   * Every stage change on this deck, read ONCE for the two panels that need it
   * (Feedback Rv2, items 11 and 13). Main Deck on the dev project carries 1.194
   * of them; each panel reading its own copy is that payload twice on one
   * screen open. Oldest first, as the API returns them -- each panel orders it
   * the way it presents it.
   */
  const [events, setEvents] = useState<DeckEvent[] | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [eventsAttempt, setEventsAttempt] = useState(0)
  const reloadEvents = useCallback(() => setEventsAttempt((n) => n + 1), [])
  const loadedDeckId = deck?.id ?? null
  useEffect(() => {
    if (loadedDeckId === null) return
    let cancelled = false
    listDeckEvents(loadedDeckId)
      .then((rows) => {
        if (cancelled) return
        setEventsError(null)
        setEvents(rows)
      })
      .catch((e: Error) => {
        if (!cancelled) setEventsError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [loadedDeckId, eventsAttempt])
  /**
   * The bays works this deck is part of. Since 0024 a coat list belongs to a
   * (work, deck), so A3.2 shows one panel per work; a deck in no work has no
   * coats to configure and is sent to the Công việc screen instead.
   */
  const [works, setWorks] = useState<DeckWork[] | null>(null)
  const [worksError, setWorksError] = useState<string | null>(null)
  /**
   * Which work's coats A3.2 shows when the deck is in several: a searchable
   * select (FLT-07), the first work until one is chosen. Every work shown once
   * stays mounted, hidden, so an unsaved draft survives switching away and
   * back, as it did when this was a row of tabs.
   */
  const [stageWorkId, setStageWorkId] = useState<string | null>(null)
  const [seenStageWorks, setSeenStageWorks] = useState<string[]>([])
  const fullOptions = useFullOptionsProps()
  const activeStageWork = works?.find((w) => w.work.id === stageWorkId)?.work.id ?? works?.[0]?.work.id
  /**
   * RV6-36: the deck's quantity is its works'. One work, or several agreeing:
   * `Khối lượng sàn (tấn)`. Works that disagree: `Số lượng sàn`, no unit, and
   * the figure printed bare. A deck in no work yet -- or one whose works have
   * not loaded -- keeps `Diện tích sàn (m²)`.
   */
  // AD4: never a bare figure. Works that disagree keep `Số lượng sàn` and
  // print their first work's unit (`deckUnitOf`).
  const unit: string = deckUnitOf((works ?? []).map((w) => w.work))
  const quantityLabel = works === null || works.length === 0
    ? DEFAULT_QUANTITY_LABEL
    : (unitOfWorks(works.map((w) => w.work)) === null
      ? MIXED_QUANTITY_LABEL
      : labelOfWorks(works.map((w) => w.work)) ?? MIXED_QUANTITY_LABEL)
  const quantityTitle = `${quantityLabel} sàn (${unit})`
  const withUnit = (n: number) => `${formatAreaM2(n)} ${unit}`

  const load = useCallback(async () => {
    if (creating || !deckId) return
    setLoading(true)
    try {
      const row = await getDeck(deckId)
      setDeck(row)
      if (row) {
        setName(row.name)
        setCode(row.code)
        setArea(row.totalAreaM2)
      }
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [creating, deckId])

  useEffect(() => {
    void load()
  }, [load])

  // Loaded alongside the deck, and again after every save: the works a deck is
  // in are edited on the Công việc screen, so a stale list here would offer a
  // coat panel for a work this deck has just left.
  const deckRowId = deck?.id ?? null
  useEffect(() => {
    if (!deckRowId) return
    let cancelled = false
    listDeckWorks(deckRowId)
      .then((rows) => { if (!cancelled) { setWorks(rows); setWorksError(null) } })
      .catch((e: Error) => { if (!cancelled) setWorksError(e.message) })
    return () => { cancelled = true }
  }, [deckRowId, deck])

  const takePdf = async (file: File | null) => {
    setPdf(file)
    setPage(1)
    setPages(1)
    if (!file) return
    try {
      setPages(await pdfPageCount(file))
    } catch {
      setPdf(null)
      setError('Không đọc được tệp PDF này. Chọn tệp khác.')
    }
  }

  /**
   * Writes the whole form in one go.
   *
   * Order is chosen for the half-failed case, the same way `DeckEditor.apply`
   * chooses its: the deck exists before anything is attached to it, so a run
   * that stops part way leaves a deck with a name and no drawing -- something
   * the admin can see and finish -- rather than a drawing belonging to nothing.
   */
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      let id = deck?.id
      const ownerProject = deck?.projectId ?? search.get('project')
      if (!ownerProject) throw new Error('Chưa biết sàn này thuộc dự án nào. Mở lại từ danh sách sàn.')

      if (creating) {
        const siblings = await listDecks(ownerProject)
        id = await createDeck({ projectId: ownerProject, seq: siblings.length + 1, name, code })
      } else if (id) {
        await updateDeckIdentity(id, name, code)
      }
      if (!id) throw new Error('Không lưu được sàn.')

      if (pdf) {
        const rendered = await renderPdfPage(pdf, page)
        await uploadDrawing(id, ownerProject, rendered.blob, rendered.width, rendered.height, {
          name: pdf.name,
          page: pages > 1 ? page : null,
        })
      }
      // Always 'prorated': pixel share is the only way a cell area is produced.
      await updateDeckArea(id, area, 'prorated')
      // RV6-18/19: the total just written is the denominator every persisted
      // bay's area_m2 is supposed to share. Re-prorate on every such save, not
      // only when the number changed, so a deck whose bays already disagree
      // with its total (stale from before this fix) is repaired by the next
      // save. After updateDeckArea, not before: a failure here leaves the
      // total right and the bays stale, the state the app was already in.
      if (!creating && deck && deck.cellCount > 0) {
        await reprorateDeckCells(id, area)
      }

      setPdf(null)
      // `relative: 'path'` because `..` otherwise walks the ROUTE tree, which
      // is nested differently here than in any test that renders this screen on
      // its own -- and the deck's address is a path, not a route depth.
      // `replace` so Back does not offer to create the deck a second time.
      setConfirmingSave(false)
      if (creating) navigate(`../${id}`, { replace: true, relative: 'path' })
      else {
        setEditing(false)
        await load()
        message.success('Đã lưu thông tin sàn')
      }
    } catch (e) {
      setConfirmingSave(false)
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /**
   * What this save would do beyond writing the two text fields.
   *
   * Empty is the ordinary case, and an empty list means no dialog at all.
   */
  const saveConsequences: { label: string; meta?: string }[] = []
  if (!creating && pdf) {
    saveConsequences.push({
      label: `Thay bản vẽ bằng ${pdf.name}`,
      meta: deck?.drawingName ?? 'bản vẽ hiện tại',
    })
  }
  if (!creating && deck && area !== deck.totalAreaM2) {
    saveConsequences.push({
      label: `${quantityLabel} sàn ${formatAreaM2(deck.totalAreaM2)} → ${withUnit(area)}`,
      meta: deck.cellCount ? `${deck.cellCount} ô` : 'chưa dựng ô',
    })
  }

  if (loading) return <Spin style={{ display: 'block', margin: '25vh auto' }} />

  if (!creating && !deck) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {error && <Alert type="error" message={error} />}
        <Alert type="warning" message="Không tìm thấy sàn này." />
        <Button onClick={() => navigate('..', { relative: 'path' })}>Về danh sách sàn</Button>
      </Space>
    )
  }

  /**
   * What the deck's drawing came from, in the admin's terms.
   *
   * "Đã có" was the whole of it, and it left an admin who had uploaded a
   * drawing and come back with no way to tell WHICH file they had used -- on a
   * project whose sheets are all called things like 00171-14. Decks whose
   * drawing predates recording this say so rather than inventing a name.
   */
  const drawingLabel = !deck?.imagePath
    ? 'Chưa có'
    : deck.drawingName
      ? `${deck.drawingName}${deck.drawingPage ? ` (trang ${deck.drawingPage})` : ''}`
      : 'Đã có (không rõ tên tệp)'

  const identity = (
    /*
      Three fields across, wrapping, rather than three full-width rows. Name,
      code and area are all short values, and stacking them puts the PDF picker
      -- the one destructive control on this panel -- below the fold on a
      laptop. The drawing block takes the full width because its filename and
      its warning need the room.
    */
    <Form
      layout="vertical"
      style={{ display: 'flex', flexWrap: 'wrap', gap: '0 18px', alignItems: 'flex-start' }}
    >
      {/*
        Ids by hand: these are controlled inputs rather than antd Form fields,
        and without one the label is text sitting next to a box -- no screen
        reader, and no test, can tell which box it belongs to.
      */}
      <Form.Item label="Tên sàn" htmlFor="deck-name" required style={{ flex: '1 1 210px', minWidth: 0 }}>
        <Input id="deck-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Form.Item>
      <Form.Item label="Mã sàn" htmlFor="deck-code" required style={{ flex: '1 1 210px', minWidth: 0 }}>
        <Input id="deck-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </Form.Item>
      <Form.Item
        label={quantityTitle}
        htmlFor="deck-area"
        required
        style={{ flex: '1 1 210px', minWidth: 0 }}
      >
        <InputNumber
          style={{ width: '100%' }}
          id="deck-area"
          value={area}
          min={0}
          step={10}
          // A Vietnamese admin types "5258,5". Without this antd parses that as
          // 5258 and the deck silently loses half a square metre from the
          // denominator of every percentage on the project. The shared props
          // also read "5.258,5", which decimalSeparator="," alone left at 5.258,
          // and "5.258" as thousands, as an area is written.
          {...viAreaInputProps}
          onChange={(n) => setArea(n ?? 0)}
        />
      </Form.Item>
      <Form.Item label="Bản vẽ (PDF)" style={{ flex: '1 1 100%', minWidth: 0 }}>
        {/*
          What is on the deck right now, above the picker that would replace it:
          choosing a file is a destructive act on a deck that already has one,
          and the admin should be able to see what they are about to lose.
        */}
        {/*
          antd's Upload rather than a bare file input. `beforeUpload` returns
          false so nothing is sent anywhere: this deck's PDF is rendered to a
          PNG in the browser and uploaded by `save`, not by the picker.

          `id` is forwarded to the real <input>, which is what the Form.Item's
          label points at -- so the control keeps an accessible name, and
          keeps being addressable by it.
        */}
        <div ref={uploadWrapRef}>
        <Upload
          accept="application/pdf"
          maxCount={1}
          beforeUpload={(file) => {
            void takePdf(file)
            return false
          }}
          onRemove={() => {
            void takePdf(null)
            return true
          }}
          fileList={
            pdf ? [{ uid: 'pending', name: pdf.name, status: 'done' as const }] : []
          }
        >
          <Button icon={<UploadOutlined aria-hidden />}>Chọn tệp PDF</Button>
        </Upload>
        </div>
        {!creating && (
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              maxWidth: 520,
            }}
          >
            <FilePdfOutlined style={{ color: palette.textTertiary, flex: 'none' }} />
            <span
              style={{
                ...type.caption,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {`Đang dùng: ${drawingLabel}`}
            </span>
          </div>
        )}
        {/*
          Said before the picker is used, not after. A new file replaces the
          image only (uploadDrawing upserts the PNG and the decks row; nothing
          touches cells), so the bays stay where they were on the sheet and
          may need checking in Phân ô -- as the Lưu dialog says too.
        */}
        {!creating && deck?.imagePath && (
          <div
            style={{
              display: 'flex',
              gap: 7,
              alignItems: 'flex-start',
              marginTop: 8,
              maxWidth: 520,
              ...type.caption,
              lineHeight: 1.45,
              color: palette.warning,
            }}
          >
            <WarningOutlined style={{ marginTop: 2, flex: 'none' }} />
            <span>Tệp mới thay bản vẽ hiện tại và giữ nguyên các ô đã dựng.</span>
          </div>
        )}
        {pages > 1 && (
          <Space>
            <label htmlFor="deck-page">Trang</label>
            <InputNumber
              id="deck-page"
              min={1}
              max={pages}
              // A whole page: "1.230" is page 1230, never 1.23.
              {...viIntegerInputProps}
              value={page}
              onChange={(n) => setPage(n ?? 1)}
            />
            <Typography.Text type="secondary">{`Tệp có ${pages} trang`}</Typography.Text>
          </Space>
        )}
      </Form.Item>
      <Space style={{ flex: '1 1 100%' }}>
        <Button
          type="primary"
          loading={saving}
          disabled={!name || !code}
          onClick={() => (saveConsequences.length > 0 ? setConfirmingSave(true) : void save())}
        >
          {creating ? 'Tạo sàn' : 'Lưu thông tin sàn'}
        </Button>
        <Button
          disabled={saving}
          onClick={() => {
            if (creating) navigate('..', { relative: 'path' })
            else {
              setName(deck?.name ?? '')
              setCode(deck?.code ?? '')
              setArea(deck?.totalAreaM2 ?? 0)
              setPdf(null)
              setEditing(false)
            }
          }}
        >
          Huỷ
        </Button>
      </Space>
    </Form>
  )

  const cancelEdit = () => {
    if (creating) {
      navigate('..', { relative: 'path' })
      return
    }
    setName(deck?.name ?? '')
    setCode(deck?.code ?? '')
    setArea(deck?.totalAreaM2 ?? 0)
    setPdf(null)
    setEditing(false)
  }

  return (
    <>
      <PageHeader
        sticky
        title={creating ? 'Sàn mới' : (deck?.name ?? '')}
        badge={creating ? undefined : deck?.code}
        facts={
          creating
            ? undefined
            : [
              deck?.cellCount ? { value: deck.cellCount, label: 'ô' } : { label: 'chưa dựng ô' },
              { value: formatAreaM2(deck?.totalAreaM2 ?? 0), label: unit ?? undefined },
            ]
        }
        breadcrumbs={[{ label: 'Sàn', onClick: () => navigate('..', { relative: 'path' }) }]}
        onBack={() => navigate('..', { relative: 'path' })}
        extra={
          creating ? undefined : (
            <>
              {progress !== null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ ...type.label, color: palette.textTertiary }}>
                    Tiến độ sàn
                    <InfoTip text="Tổng hợp các công việc" />
                  </div>
                  <div style={{ marginTop: 7, ...type.displaySm, letterSpacing: '-0.032em' }}>
                    {formatPercent(progress)}
                  </div>
                </div>
              )}
              {/*
                A mode switch, not a "Sửa" button. Curating a deck replaces
                every bay, so which mode you are in has to be legible at a
                glance rather than inferred from whether a form is on screen.
              */}
              <Segmented
                value={editing ? 'edit' : 'view'}
                onChange={(v) => (v === 'edit' ? setEditing(true) : cancelEdit())}
                options={[
                  { label: 'Xem', value: 'view' },
                  { label: 'Sửa', value: 'edit' },
                ]}
              />
            </>
          )
        }
      />

      <PageBody>
        {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

        <SectionCard
          code="A3.1"
          title="Thông tin sàn & bản vẽ"
          facts={creating ? undefined : [{ value: drawingLabel }]}
          collapsible
        >
          {/*
            The read-only cards are NOT an alternative to the form -- they sit
            above it in both modes. In edit mode they are what the admin checks
            their typing against: the deck as it is stored right now, beside the
            fields about to overwrite it.
          */}
          {(
            <div
              data-testid="deck-identity"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))',
                gap: 14,
              }}
            >
              <IdentityCard label="Tên sàn" value={deck?.name ?? ''} />
              <IdentityCard label="Mã sàn" value={deck?.code ?? ''} />
              <IdentityCard
                label={quantityTitle}
                value={formatAreaM2(deck?.totalAreaM2 ?? 0)}
                tip="Mẫu số của mọi phần trăm trên sàn"
              />
              <IdentityCard label="Số ô" value={String(deck?.cellCount ?? 0)} />
              <IdentityCard
                label="Bản vẽ (PDF)"
                value={drawingLabel}
                sub={deck?.imagePath ? undefined : 'Cần tải PDF trước khi dựng ô'}
              />
            </div>
          )}
          {editing && (
            <div
              style={{
                marginTop: 18,
                paddingTop: 18,
                borderTop: `1px solid ${palette.borderSplit}`,
              }}
            >
              {identity}
            </div>
          )}
        </SectionCard>

        {/*
          Above the drawing tools on purpose: the stages are what the bays are
          eventually painted to, so they are the deck's spec and the bays are
          the work against it. Declaring them after drawing 180 bays reads
          backwards.

          The drawing tools belong to editing, and only once there is a deck to
          attach them to: in create mode there is no deck id, no drawing and no
          cells for them to work on.
        */}
        {deck && works !== null && works.length === 0 && (
          <SectionCard code="A3.2" title="Cấu hình lớp sơn">
            <EmptyState
              title="Sàn này chưa thuộc công việc nào"
              description="Gán sàn vào một công việc trước, rồi quay lại đây cấu hình lớp sơn."
            />
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Link to={`${APP_BASE_PATH}/admin/works?project=${deck.projectId}`}>Mở Công việc</Link>
            </div>
          </SectionCard>
        )}
        {worksError && <Alert type="error" showIcon message={worksError} />}
        {deck && works !== null && works.length === 1 && (
          <StageConfigPanel workId={works[0].work.id} deckId={deck.id} editable={editing} onSaved={() => void load()} />
        )}
        {deck && works !== null && works.length > 1 && (
          <div>
            {works
              .filter((w) => w.work.id === activeStageWork || seenStageWorks.includes(w.work.id))
              .map((w) => (
                <div key={w.work.id} hidden={w.work.id !== activeStageWork}>
                  <StageConfigPanel
                    workId={w.work.id}
                    deckId={deck.id}
                    editable={editing}
                    onSaved={() => void load()}
                    // In the visible card's header, named by the card (M7).
                    workSelect={w.work.id === activeStageWork && (
                      <Select
                        aria-label="Công việc · Cấu hình lớp sơn"
                        {...searchSelectProps}
                        {...fullOptions}
                        style={{ width: WORK_SELECT_WIDTH }}
                        value={activeStageWork}
                        onChange={(id: string) => {
                          if (activeStageWork !== undefined) {
                            setSeenStageWorks((seen) => (seen.includes(activeStageWork) ? seen : [...seen, activeStageWork]))
                          }
                          setStageWorkId(id)
                        }}
                        options={works.map((x) => ({ label: x.work.name, value: x.work.id }))}
                      />
                    )}
                  />
                </div>
              ))}
          </div>
        )}

        {deck && (
          <DeckEditor deck={deck} editable={editing} quantityLabel={quantityLabel} unit={unit} onSaved={() => void load()} />
        )}

        {/* Progress lives here rather than on a screen of its own: everything on
            it is about THIS deck, and making the admin pick a project and then a
            deck to reach what this screen already knows was one navigation too
            many. The project-wide half -- the rollup and the export -- stayed on
            the decks list, which is where a project-wide thing belongs.

            Rendered in BOTH modes. It used to be edit-only, which made the deck's
            view five lines of text and meant pressing "Sửa" to look at the
            drawing. Looking is not editing; only the writes are behind the
            button. */}
        {deck && (
          <DeckProgressPanel deckId={deck.id} editable={editing} onProgress={setProgress} />
        )}

        {/* Man-hours per update (Feedback Rv2, item 11), with the admin's
            backfill for rows written before hours existed. Under the progress
            panel because it is the same history seen by the hour, not the coat.

            The events are read ONCE here and handed to both panels: the deck's
            history is over a thousand rows on Main Deck, and reading it twice
            on one screen is a second of the admin's time for nothing. */}
        {deck && (
          <EffortHistoryPanel
            deckId={deck.id}
            editable={editing}
            events={events}
            error={eventsError}
            onRetry={reloadEvents}
            onSaved={reloadEvents}
          />
        )}

        {/* What is left, and whether the deadline holds (Feedback Rv2, item 13). */}
        {deck && <DeckForecastPanel deckId={deck.id} editable={editing} events={events} />}
      </PageBody>

      <ConsequenceModal
        open={confirmingSave}
        tone="warn"
        tag="Cần đọc trước khi lưu"
        title="Lưu thay đổi cho sàn này?"
        description="Ngoài tên và mã, lần lưu này còn:"
        items={saveConsequences}
        consequences={[
          ...(pdf ? ['Ô đã dựng giữ vị trí cũ trên bản vẽ mới, cần kiểm tra lại ở Phân ô'] : []),
          // reprorateDeckCells rewrites every bay's area_m2, which the done m²,
          // the KPI actuals (progressApi reads cell.area_m2) and the report sum.
          ...(deck && area !== deck.totalAreaM2
            ? ['Diện tích từng ô được chia lại theo con số mới', 'Diện tích đã làm, KPI thực hiện và báo cáo tính theo diện tích sàn mới']
            : []),
        ]}
        okText="Lưu"
        confirmLoading={saving}
        onCancel={() => setConfirmingSave(false)}
        onOk={() => void save()}
      />
    </>
  )
}
