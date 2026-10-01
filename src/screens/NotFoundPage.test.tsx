import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { COPYRIGHT } from '../test/copy'
import { NotFoundPage } from './NotFoundPage'

describe('NotFoundPage', () => {
  // RV7-2: the signed-in not-found page ends with the copyright line too.
  it('ends with the copyright line, after the way home', () => {
    render(
      <MemoryRouter>
        <NotFoundPage home="/admin/projects" />
      </MemoryRouter>,
    )
    const home = screen.getByRole('link', { name: 'Về trang chính' })
    const line = screen.getByText(COPYRIGHT)
    expect(home.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Inside AdminLayout, which already ends with the line: once, not twice.
  it('leaves the copyright line to the shell it is drawn in', () => {
    render(
      <MemoryRouter>
        <NotFoundPage home="/admin/projects" inShell />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Về trang chính' })).toBeInTheDocument()
    expect(screen.queryByText(COPYRIGHT)).toBeNull()
  })
})
