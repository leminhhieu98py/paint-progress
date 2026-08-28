import { WarningOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, InputNumber, Segmented, Space, Spin, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { NEW_DECK } from '../../config'
import {
  createDeck, getDeck, listDecks, updateDeckArea, updateDeckIdentity, uploadDrawing,
  type DeckRow,
} from '../../lib/decksApi'
import { formatAreaM2 } from '../../lib/format'
import { pdfPageCount, renderPdfPage } from '../../lib/pdfToPng'
import { DeckEditor } from './DeckEditor'
import { StageConfigPanel } from './StageConfigPanel'
import { DeckProgressPanel } from './DeckProgressPanel'
import { Mono } from '../../components/Mono'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { formatPercent } from '../../lib/format'
import { palette } from '../../theme'

const IDENTITY_RULES = [
  {
    id: 'IDN-R5',
    text: 'Diện tích nhận dấu phẩy thập phân: 5258,5 phải vào đúng là 5258,5 chứ không thành 5258.',
  },
  {
    id: 'IDN-R4',
    text: 'Tên tệp và trang của bản vẽ hiện tại luôn hiện trước nút chọn tệp, vì chọn tệp mới là thao tác phá huỷ.',
  },
]

/** One read-only fact about the deck, in the card grid of panel A3.1. */
function IdentityCard({
  label,
  value,
  sub,
  mono = false,
}: {
  label: string
  value: string
  sub?: string
  mono?: boolean
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
      <div style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>{label}</div>
      <div style={{ marginTop: 9, fontSize: mono ? 13 : 16, fontWeight: 600, lineHeight: 1.25, wordBreak: mono ? 'break-all' : 'normal' }}>
        {mono ? <Mono>{value}</Mono> : value}
      </div>
      {sub !== undefined && (
        <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.4, color: palette.textTertiary }}>
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
  /**
   * The deck's own percentage, for the header.
   *
   * Reported up by the progress panel rather than fetched again here: that
   * panel already loads every cell and every stage of this deck to draw them,
   * and a second read of the same payload for one number is the heaviest query
   * on the screen run twice.
   */
  const [progress, setProgress] = useState<number | null>(null)

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

      setPdf(null)
      // `relative: 'path'` because `..` otherwise walks the ROUTE tree, which
      // is nested differently here than in any test that renders this screen on
      // its own -- and the deck's address is a path, not a route depth.
      // `replace` so Back does not offer to create the deck a second time.
      if (creating) navigate(`../${id}`, { replace: true, relative: 'path' })
      else {
        setEditing(false)
        await load()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
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
    <Form layout="vertical">
      {/*
        Ids by hand: these are controlled inputs rather than antd Form fields,
        and without one the label is text sitting next to a box -- no screen
        reader, and no test, can tell which box it belongs to.
      */}
      <Form.Item label="Tên sàn" htmlFor="deck-name" required>
        <Input id="deck-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Form.Item>
      <Form.Item label="Mã sàn" htmlFor="deck-code" required>
        <Input id="deck-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </Form.Item>
      <Form.Item label="Diện tích sàn (m²)" htmlFor="deck-area" required>
        <InputNumber
          id="deck-area"
          value={area}
          min={0}
          step={10}
          // A Vietnamese admin types "5258,5". Without this antd parses that as
          // 5258 and the deck silently loses half a square metre from the
          // denominator of every percentage on the project.
          decimalSeparator=","
          onChange={(n) => setArea(n ?? 0)}
        />
      </Form.Item>
      <Form.Item label="Bản vẽ (PDF)">
        {/*
          What is on the deck right now, above the picker that would replace it:
          choosing a file is a destructive act on a deck that already has one,
          and the admin should be able to see what they are about to lose.
        */}
        {!creating && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {`Đang dùng: ${drawingLabel}`}
          </Typography.Paragraph>
        )}
        <input
          type="file"
          accept="application/pdf"
          aria-label="Bản vẽ (PDF)"
          onChange={(e) => void takePdf(e.target.files?.[0] ?? null)}
        />
        {/*
          Said before the picker is used, not after. Replacing the drawing
          drops every bay on the deck, which takes the recorded progress with
          it -- and the picker gives no second chance once a file is chosen.
        */}
        {!creating && deck?.imagePath && (
          <div
            style={{
              display: 'flex',
              gap: 7,
              alignItems: 'flex-start',
              marginTop: 8,
              maxWidth: 520,
              fontSize: 11,
              lineHeight: 1.45,
              color: palette.error,
            }}
          >
            <WarningOutlined style={{ marginTop: 2, flex: 'none' }} />
            <span>Chọn tệp mới sẽ xoá bản vẽ hiện tại và toàn bộ hình học ô của sàn này.</span>
          </div>
        )}
        {pages > 1 && (
          <Space>
            <label htmlFor="deck-page">Trang</label>
            <InputNumber
              id="deck-page"
              min={1}
              max={pages}
              value={page}
              onChange={(n) => setPage(n ?? 1)}
            />
            <Typography.Text type="secondary">{`Tệp có ${pages} trang`}</Typography.Text>
          </Space>
        )}
      </Form.Item>
      <Space>
        <Button type="primary" loading={saving} disabled={!name || !code} onClick={() => void save()}>
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
        subtitle={
          creating
            ? 'Đặt tên, mã và diện tích trước, rồi tải bản vẽ lên.'
            : `${deck?.cellCount ? `${deck.cellCount} ô` : 'chưa dựng ô'} · ${formatAreaM2(deck?.totalAreaM2 ?? 0)} m²`
        }
        breadcrumbs={[{ label: 'Sàn', onClick: () => navigate('..', { relative: 'path' }) }]}
        onBack={() => navigate('..', { relative: 'path' })}
        extra={
          creating ? undefined : (
            <>
              {progress !== null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>
                    Tiến độ sàn
                  </div>
                  <div style={{ marginTop: 7, fontSize: 23, fontWeight: 700, letterSpacing: '-0.032em' }}>
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
          summary={creating ? 'Sàn chưa được tạo' : drawingLabel}
          collapsible
          footer={<RulesDisclosure rules={IDENTITY_RULES} />}
        >
          {editing ? (
            identity
          ) : (
            <div
              data-testid="deck-identity"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))',
                gap: 14,
              }}
            >
              <IdentityCard label="Tên sàn" value={deck?.name ?? ''} />
              <IdentityCard label="Mã sàn" value={deck?.code ?? ''} mono />
              <IdentityCard
                label="Diện tích sàn (m²)"
                value={formatAreaM2(deck?.totalAreaM2 ?? 0)}
                sub="Mẫu số của mọi phần trăm trên sàn"
              />
              <IdentityCard label="Số ô" value={String(deck?.cellCount ?? 0)} />
              <IdentityCard
                label="Bản vẽ (PDF)"
                value={drawingLabel}
                mono
                sub={deck?.imagePath ? undefined : 'Cần tải PDF trước khi dựng ô'}
              />
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
        {editing && deck && (
          <SectionCard code="A3.2" title="Cấu hình lớp sơn" collapsible bodyPadding={0}>
            <StageConfigPanel deckId={deck.id} onSaved={() => void load()} />
          </SectionCard>
        )}

        {editing && deck && (
          <SectionCard code="A3.3" title="Phân ô" collapsible bodyPadding={0}>
            <DeckEditor deck={deck} onSaved={() => void load()} />
          </SectionCard>
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
        {/*
          A3.4 carries no summary. The header above is sticky and already shows
          the deck's percentage in the largest type on the screen; repeating it
          here would be the same number twice in one viewport.
        */}
        {deck && (
          <SectionCard code="A3.4" title="Tiến độ theo lớp sơn" collapsible bodyPadding={0}>
            <DeckProgressPanel deckId={deck.id} editable={editing} onProgress={setProgress} />
          </SectionCard>
        )}
      </PageBody>
    </>
  )
}
