import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createDeck, listDecks, uploadDrawing, type DeckRow } from '../../lib/decksApi'
import { formatAreaM2 } from '../../lib/format'
import { listProjectNames } from '../../lib/projectsApi'
import { imageFileToPng, pdfPageCount, renderPdfPage, type RenderedPage } from '../../lib/pdfToPng'
import { DeckEditor } from './DeckEditor'

interface CreateValues {
  name: string
  code: string
}

/** Page picked from a multi-page PDF, awaiting the admin's confirmation. */
interface PendingPicker {
  deck: DeckRow
  file: File
  pageCount: number
  page: number
}

type ProjectOption = Awaited<ReturnType<typeof listProjectNames>>[number]

export function DecksScreen() {
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [decks, setDecks] = useState<DeckRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [openDeck, setOpenDeck] = useState<DeckRow | null>(null)
  const [picker, setPicker] = useState<PendingPicker | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputs = useRef(new Map<string, HTMLInputElement | null>())

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listProjectNames()
        setProjects(rows)
        // Only seed the default once: an explicit later choice must not be
        // clobbered if the project list happens to refresh.
        setProjectId((prev) => prev ?? rows[0]?.id ?? null)
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
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

  const finishImport = async (deck: DeckRow, rendered: RenderedPage) => {
    await uploadDrawing(deck.id, deck.projectId, rendered.blob, rendered.width, rendered.height)
    await refreshDecks()
  }

  const onFileSelected = (deck: DeckRow) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so choosing the same file again still fires a change event.
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      if (file.type === 'application/pdf') {
        const pageCount = await pdfPageCount(file)
        if (pageCount > 1) {
          setPicker({ deck, file, pageCount, page: 1 })
          return
        }
        await finishImport(deck, await renderPdfPage(file, 1))
      } else {
        await finishImport(deck, await imageFileToPng(file))
      }
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const confirmPicker = async () => {
    if (!picker) return
    setBusy(true)
    try {
      const rendered = await renderPdfPage(picker.file, picker.page)
      await finishImport(picker.deck, rendered)
      setPicker(null)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onCreateDeck = async (values: CreateValues) => {
    if (!projectId) return
    try {
      await createDeck({ projectId, seq: decks.length + 1, name: values.name, code: values.code })
      setCreateOpen(false)
      setError(null)
      await refreshDecks()
    } catch (e) {
      // Deliberately leaves the modal open so the typed values survive.
      setError((e as Error).message)
    }
  }

  if (openDeck) {
    return (
      <DeckEditor
        deck={openDeck}
        onClose={() => {
          setOpenDeck(null)
          void refreshDecks()
        }}
      />
    )
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      <Space>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Sàn
        </Typography.Title>
        <Select
          style={{ width: 240 }}
          value={projectId ?? undefined}
          placeholder="Chọn dự án"
          options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
          onChange={(v) => setProjectId(v)}
        />
        <Button type="primary" disabled={!projectId} onClick={() => setCreateOpen(true)}>
          Tạo sàn
        </Button>
      </Space>

      <Table<DeckRow>
        rowKey="id"
        loading={loading}
        dataSource={decks}
        pagination={false}
        columns={[
          { title: 'Tên sàn', dataIndex: 'name' },
          { title: 'Mã', dataIndex: 'code', width: 100 },
          { title: 'Số ô', dataIndex: 'cellCount', width: 90 },
          {
            title: 'Diện tích (m²)',
            dataIndex: 'totalAreaM2',
            width: 160,
            render: (v: number) => formatAreaM2(v),
          },
          {
            title: 'Bản vẽ',
            key: 'drawing',
            width: 160,
            render: (_v, deck) => (
              <>
                <input
                  ref={(el) => {
                    fileInputs.current.set(deck.id, el)
                  }}
                  type="file"
                  accept="application/pdf,image/*"
                  data-testid={`drawing-input-${deck.id}`}
                  style={{ display: 'none' }}
                  onChange={(e) => void onFileSelected(deck)(e)}
                />
                <Button size="small" onClick={() => fileInputs.current.get(deck.id)?.click()}>
                  Tải bản vẽ
                </Button>
              </>
            ),
          },
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_v, deck) => (
              <Button size="small" onClick={() => setOpenDeck(deck)}>
                Mở
              </Button>
            ),
          },
        ]}
      />

      <Modal
        open={createOpen}
        title="Tạo sàn"
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form<CreateValues> layout="vertical" onFinish={(v) => void onCreateDeck(v)}>
          <Form.Item name="name" label="Tên sàn" rules={[{ required: true, message: 'Nhập tên sàn' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Mã sàn" rules={[{ required: true, message: 'Nhập mã sàn' }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Tạo
          </Button>
        </Form>
      </Modal>

      <Modal
        open={picker !== null}
        title="Chọn trang bản vẽ"
        okText="Nhập bản vẽ"
        cancelText="Huỷ"
        confirmLoading={busy}
        destroyOnHidden
        onCancel={() => setPicker(null)}
        onOk={() => void confirmPicker()}
      >
        {picker && (
          <Space direction="vertical">
            <Typography.Paragraph>
              Tệp PDF này có {picker.pageCount} trang. Chọn trang cần nhập.
            </Typography.Paragraph>
            <label htmlFor="deck-picker-page">Trang</label>
            <InputNumber
              id="deck-picker-page"
              min={1}
              max={picker.pageCount}
              value={picker.page}
              onChange={(n) => setPicker((p) => (p ? { ...p, page: n ?? 1 } : p))}
            />
          </Space>
        )}
      </Modal>
    </Space>
  )
}
