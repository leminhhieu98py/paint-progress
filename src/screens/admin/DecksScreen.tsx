import { Alert, Button, Select, Space, Table, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDecks, type DeckRow } from '../../lib/decksApi'
import { formatAreaM2 } from '../../lib/format'
import { listProjectNames } from '../../lib/projectsApi'
import { NEW_DECK } from '../../config'

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
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [decks, setDecks] = useState<DeckRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        <Button
          type="primary"
          disabled={!projectId}
          onClick={() => navigate(`${NEW_DECK}?project=${projectId}`)}
        >
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
            width: 110,
            render: (_v, deck) => (deck.imagePath ? 'Đã có' : 'Chưa có'),
          },
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_v, deck) => (
              <Button size="small" onClick={() => navigate(deck.id)}>
                Mở
              </Button>
            ),
          },
        ]}
      />
    </Space>
  )
}
