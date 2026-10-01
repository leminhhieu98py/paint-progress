import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { COPYRIGHT } from '../../test/copy'
import { FieldLayout } from './FieldLayout'

// The header reads the project over the network and is not what is under test.
vi.mock('./FieldHeader', () => ({ FieldHeader: () => null }))

describe('FieldLayout', () => {
  // RV7-2: every field page (GS, field Năng suất, field KPI) ends with the
  // copyright line, after the page and inside the space kept above the tab bar.
  it('ends every field page with the copyright line', () => {
    const { container } = render(
      <FieldLayout projectId={null}>
        <div>nội dung trang</div>
      </FieldLayout>,
    )
    const line = screen.getByText(COPYRIGHT)
    const layout = container.querySelector('.ant-layout') as HTMLElement
    expect(layout.lastElementChild).toBe(line)
    expect(
      screen.getByText('nội dung trang').compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
