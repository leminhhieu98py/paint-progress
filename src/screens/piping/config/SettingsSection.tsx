import { App, Button, Form } from 'antd'
import { useEffect, useState } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import type { PipingSettings } from '../../../domain/piping/types'
import { MISSING } from '../../../lib/format'
import { listReinstatementEntries, updatePipingSettings, type PipingSettingsInput } from '../../../lib/pipingApi'
import { PipingSettingsFields } from '../PipingSettingsFields'
import { settingsInput, settingsValues, type PipingSettingsValues } from '../pipingSettingsForm'

const COUNT = new Intl.NumberFormat('vi-VN')

/**
 * Thông số (spec §2): the week start date, total Test Pack and late threshold.
 * A total below the Test Packs already entered, or none while entries exist,
 * is allowed after a warning: entries stop at the total (Q9A, R-4) until it
 * is raised.
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

  /**
   * A total under what is entered, or no total at all while entries exist,
   * blocks every new or raised entry -- the GS's and the admin's edits alike
   * (spec §4, R-4) -- so it is saved only after a warning.
   */
  const submit = (values: PipingSettingsValues) => {
    const input = settingsInput(values)
    const total = input.totalTestPacks
    const blocks = entered !== null && entered > 0 && (total === null || total < entered)
    if (blocks) setPending(input)
    else void save(input)
  }

  const cleared = pending !== null && pending.totalTestPacks === null

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
        title={cleared ? 'Bỏ trống tổng Test Pack khi đã có số nhập?' : 'Tổng Test Pack nhỏ hơn số đã nhập'}
        items={[
          { label: 'Đã nhập', meta: COUNT.format(entered ?? 0) },
          { label: 'Tổng mới', meta: cleared ? MISSING : COUNT.format(pending?.totalTestPacks ?? 0) },
        ]}
        consequences={[cleared
          ? 'GS và admin không thêm, không sửa được Reinstatement cho tới khi nhập lại tổng'
          : 'GS và admin không thêm hoặc tăng được Reinstatement cho tới khi tổng lớn hơn số đã nhập']}
        okText="Vẫn lưu"
        confirmLoading={saving}
        onCancel={() => setPending(null)}
        onOk={() => pending && void save(pending)}
      />
    </>
  )
}
