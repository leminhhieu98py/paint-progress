import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

/** Throws unconditionally, standing in for a lazy chunk's rejected import(). */
function Bomb(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React logs its own noisy warning for an uncaught render error even when
    // a boundary catches it; this keeps that expected noise out of the test
    // run's output without hiding a real assertion failure.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('renders children normally when nothing below it throws', () => {
    render(
      <ErrorBoundary>
        <div>OK</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.queryByText('Đã xảy ra lỗi')).toBeNull()
  })

  it('shows a Vietnamese message and a reload action instead of unmounting the tree', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Đã xảy ra lỗi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tải lại trang' })).toBeInTheDocument()
  })

  it('reloads the page when the action is clicked', async () => {
    const reload = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', { value: { ...originalLocation, reload }, configurable: true })

    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Tải lại trang' }))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { value: originalLocation, configurable: true })
    }
  })
})
