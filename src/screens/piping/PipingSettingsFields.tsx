import { DatePicker, Form, InputNumber } from 'antd'
import { viIntegerInputProps } from '../../components/viNumberInput'

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/**
 * Week start date, total Test Pack and late threshold (spec §2), as the
 * enable dialog and Cấu hình both ask them. No min/max on the number fields:
 * antd would clamp an out-of-range value on blur without a word; the rules
 * say what is wrong instead.
 */
export function PipingSettingsFields() {
  return (
    <>
      <Form.Item
        name="weekStartDate"
        label="Ngày bắt đầu tuần"
        rules={[{ required: true, message: 'Chọn ngày bắt đầu tuần' }]}
      >
        <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name="totalTestPacks"
        label="Tổng Test Pack"
        rules={[{
          validator: (_rule, v: unknown) => (v === null || v === undefined || (isWhole(v) && v >= 0)
            ? Promise.resolve()
            : Promise.reject(new Error('Tổng Test Pack phải là số nguyên từ 0 trở lên'))),
        }]}
      >
        <InputNumber {...viIntegerInputProps} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name="lateThresholdDays"
        label="Ngưỡng trễ (ngày)"
        rules={[{
          validator: (_rule, v: unknown) => (isWhole(v) && v >= 0 && v <= 365
            ? Promise.resolve()
            : Promise.reject(new Error('Ngưỡng trễ phải từ 0 đến 365 ngày'))),
        }]}
      >
        <InputNumber {...viIntegerInputProps} style={{ width: '100%' }} />
      </Form.Item>
    </>
  )
}
