import { App, Button, Form } from 'antd'
import { useEffect, useState } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import type { PipingSettings } from '../../../domain/piping/types'
import { listReinstatementEntries, updatePipingSettings, type PipingSettingsInput } from '../../../lib/pipingApi'
import { PipingSettingsFields } from '../PipingSettingsFields'
import { settingsInput, settingsValues, type PipingSettingsValues } from '../pipingSettingsForm'

const COUNT = new Intl.NumberFormat('vi-VN')

/**
 * Thông số (spec §2): the week start date, total Test Pack and late threshold.
 * A total below the Test Packs already entered is allowed, after a warning:
 * GS entries stop at the total (Q9A) until it is raised.
 */
export function SettingsSection({ projectId, settings, onSaved }: {
  projectId: string
  settings: PipingSettings
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm<PipingSettingsValues>()
  const [entered, setEntered] = useState<number | null>(null)
  const [pending, setPending] = useState<PipingSettingsInput | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    listReinstatementEntries(projectId)
      .then((rows) => {
        if (!cancelled) setEntered(rows.reduce((sum, r) => sum + r.qty, 0))
      })
      // Unknown: no warning rather than a wrong one; the save itself is unaffected.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId])

  const save = async (input: PipingSettingsInput) => {
    setSaving(true)
    try {
      await updatePipingSettings(projectId, input)
      message.success('Đã lưu thông số')
      setPending(null)
      onSaved()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const submit = (values: PipingSettingsValues) => {
    const input = settingsInput(values)
    if (input.totalTestPacks !== null && entered !== null && input.totalTestPacks < entered) setPending(input)
    else void save(input)
  }

  return (
    <>
      <Form<PipingSettingsValues>
        form={form}
        layout="vertical"
        initialValues={settingsValues(settings)}
        onFinish={submit}
        style={{ maxWidth: 360 }}
      >
        <PipingSettingsFields />
        <Button type="primary" htmlType="submit" loading={saving}>Lưu thông số</Button>
      </Form>
      <ConsequenceModal
        open={pending !== null}
        tone="warn"
        title="Tổng Test Pack nhỏ hơn số đã nhập"
        items={[
          { label: 'Đã nhập', meta: COUNT.format(entered ?? 0) },
          { label: 'Tổng mới', meta: COUNT.format(pending?.totalTestPacks ?? 0) },
        ]}
        consequences={['GS không nhập thêm Reinstatement được cho tới khi tổng lớn hơn số đã nhập']}
        okText="Vẫn lưu"
        confirmLoading={saving}
        onCancel={() => setPending(null)}
        onOk={() => pending && void save(pending)}
      />
    </>
  )
}
