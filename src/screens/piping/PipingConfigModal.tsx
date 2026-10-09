import { App, Button, Modal, Tabs } from 'antd'
import { useState } from 'react'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { modalProps } from '../../components/modalChrome'
import type { PipingSettings } from '../../domain/piping/types'
import { disablePiping } from '../../lib/pipingApi'
import { ColumnsSection } from './config/ColumnsSection'
import { GroupsSection } from './config/GroupsSection'
import { ImportLogSection } from './config/ImportLogSection'
import { SettingsSection } from './config/SettingsSection'

/**
 * Cấu hình (spec §2, §5, §6.1, §8), the admin's alone: Thông số, Nhóm nhân
 * lực, Cột thêm của spool, Lịch sử import, and Tắt Piping, which hides the
 * module and keeps every row of data.
 *
 * Mounted only while open, so each opening reads the lists afresh.
 */
export function PipingConfigModal({ projectId, projectName, settings, onClose, onChanged, onDisabled }: {
  projectId: string
  projectName: string
  settings: PipingSettings
  onClose: () => void
  /** Something the panels read changed (settings, groups, columns). */
  onChanged: () => void
  /** Piping was turned off for the project. */
  onDisabled: () => void
}) {
  const { message } = App.useApp()
  const [disabling, setDisabling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disable = async () => {
    setBusy(true)
    setError(null)
    try {
      await disablePiping(projectId)
      message.success('Đã tắt Piping')
      setDisabling(false)
      onDisabled()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open
        title="Cấu hình Piping"
        width={820}
        onCancel={onClose}
        {...modalProps}
        footer={[
          <Button
            key="off"
            danger
            style={{ marginRight: 'auto' }}
            onClick={() => {
              setError(null)
              setDisabling(true)
            }}
          >
            Tắt Piping
          </Button>,
          <Button key="close" onClick={onClose}>Đóng</Button>,
        ]}
      >
        <Tabs
          items={[
            {
              key: 'settings',
              label: 'Thông số',
              children: <SettingsSection projectId={projectId} settings={settings} onSaved={onChanged} />,
            },
            { key: 'groups', label: 'Nhóm nhân lực', children: <GroupsSection projectId={projectId} onChanged={onChanged} /> },
            {
              key: 'columns',
              label: 'Cột thêm của spool',
              children: <ColumnsSection projectId={projectId} onChanged={onChanged} />,
            },
            { key: 'log', label: 'Lịch sử import', children: <ImportLogSection projectId={projectId} /> },
          ]}
        />
      </Modal>
      <ConsequenceModal
        open={disabling}
        tone="warn"
        icon="hide"
        title={`Tắt Piping cho ${projectName || 'dự án này'}?`}
        consequences={[
          'Màn Piping và tab Piping của GS, Visitor được ẩn',
          'Dữ liệu được giữ lại; bật lại Piping để xem tiếp',
        ]}
        okText="Tắt Piping"
        confirmLoading={busy}
        error={error}
        onCancel={() => setDisabling(false)}
        onOk={() => void disable()}
      />
    </>
  )
}
