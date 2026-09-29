import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoSpecIds } from '../test/copy'
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

  it('reveals each rule as plain text, with no spec id on screen (CPY-04)', async () => {
    const user = userEvent.setup()
    render(<RulesDisclosure rules={rules} />)
    await user.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    // The ids stay in code as keys; on screen they read as the developer's
    // vocabulary, not the admin's.
    expect(screen.getByText('Tổng trọng số phải đúng bằng 1, chưa đúng thì Lưu bị khoá.')).toBeInTheDocument()
    expect(screen.getByText('Không hai lớp trùng tên hoặc trùng màu.')).toBeInTheDocument()
    expect(screen.queryByText('STG-R1')).not.toBeInTheDocument()
    expectNoSpecIds()
  })

  it('renders nothing at all when there are no rules for this panel', () => {
    const { container } = render(<RulesDisclosure rules={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
