import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('says what is missing and what it blocks', () => {
    render(
      <EmptyState
        title="Sàn này chưa có bản vẽ"
        description="Không có bản vẽ thì không có ô để GS bấm."
      />,
    )
    expect(screen.getByText('Sàn này chưa có bản vẽ')).toBeInTheDocument()
    expect(screen.getByText('Không có bản vẽ thì không có ô để GS bấm.')).toBeInTheDocument()
  })

  it('renders the action when one is given', () => {
    render(
      <EmptyState
        title="Chưa có dự án nào"
        description="x"
        action={<button type="button">Tạo dự án</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Tạo dự án' })).toBeInTheDocument()
  })
})
