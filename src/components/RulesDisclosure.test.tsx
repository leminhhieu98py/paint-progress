import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RulesDisclosure } from './RulesDisclosure'

const rules = [
  { id: 'STG-R1', text: 'Tổng trọng số phải đúng bằng 1, chưa đúng thì Lưu bị khoá.' },
  { id: 'STG-R2', text: 'Không hai lớp trùng tên hoặc trùng màu.' },
]

describe('RulesDisclosure', () => {
  it('starts collapsed, showing only how many rules there are', () => {
    render(<RulesDisclosure rules={rules} />)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('STG-R1')).not.toBeInTheDocument()
  })

  it('reveals each rule with its spec id', async () => {
    const user = userEvent.setup()
    render(<RulesDisclosure rules={rules} />)
    await user.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    // The ids are the ones in the written spec, so a rule an admin queries on
    // screen can be looked up in the spec by the same name.
    expect(screen.getByText('STG-R1')).toBeInTheDocument()
    expect(screen.getByText('Không hai lớp trùng tên hoặc trùng màu.')).toBeInTheDocument()
  })

  it('renders nothing at all when there are no rules for this panel', () => {
    const { container } = render(<RulesDisclosure rules={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
