import { Alert, App, Button, Form, Modal } from 'antd'
import { useState } from 'react'
import { modalProps } from '../../components/modalChrome'
import type { PipingSettings } from '../../domain/piping/types'
import { enablePiping } from '../../lib/pipingApi'
import { PipingSettingsFields } from './PipingSettingsFields'
import { settingsInput, settingsValues, type PipingSettingsValues } from './pipingSettingsForm'

/**
 * Bật Piping (spec §2): the week start date (required, no default -- Q7C),
 * total Test Pack (optional) and the late threshold (default 7). Enabling
 * creates the default manpower groups. A project that had Piping before
 * opens on its stored settings.
 *
 * Mounted only while open, so each opening starts a fresh form on what is
 * stored now.
 */
export function EnablePipingModal({ projectId, stored, onCancel, onEnabled }: {
  projectId: string
  /** The disabled project's settings, or null for a project never enabled. */
  stored: PipingSettings | null
  onCancel: () => void
  onEnabled: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm<PipingSettingsValues>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enable = async (values: PipingSettingsValues) => {
    setSaving(true)
    setError(null)
    try {
      await enablePiping(projectId, settingsInput(values))
      message.success('Đã bật Piping')
      onEnabled()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title="Bật Piping"
      onCancel={onCancel}
      {...modalProps}
      footer={[
        <Button key="cancel" onClick={onCancel}>Huỷ</Button>,
        <Button key="ok" type="primary" loading={saving} onClick={() => form.submit()}>Bật Piping</Button>,
      ]}
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form<PipingSettingsValues>
        form={form}
        layout="vertical"
        initialValues={settingsValues(stored)}
        onFinish={(v) => void enable(v)}
      >
        <PipingSettingsFields />
      </Form>
    </Modal>
  )
}
