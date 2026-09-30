import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fieldType, type } from '../theme'
import { EmptyState } from './EmptyState'
import { TypeScaleProvider, useTypeScale } from './typeScale'

function Probe() {
  return <span data-testid="probe">{useTypeScale().body.fontSize}</span>
}

describe('useTypeScale (GS-10)', () => {
  it('is the admin scale unless a field page says otherwise', () => {
    render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent(String(type.body.fontSize))
  })

  it('is the field scale under the field provider', () => {
    render(<TypeScaleProvider value={fieldType}><Probe /></TypeScaleProvider>)
    expect(screen.getByTestId('probe')).toHaveTextContent('14')
  })

  it('sets a shared component\'s running text on the scale of the page it is on', () => {
    const { unmount } = render(<EmptyState title="Trống" description="Chưa có gì" />)
    expect(screen.getByText('Chưa có gì')).toHaveStyle({ fontSize: '13px' })
    unmount()
    render(<TypeScaleProvider value={fieldType}><EmptyState title="Trống" description="Chưa có gì" /></TypeScaleProvider>)
    expect(screen.getByText('Chưa có gì')).toHaveStyle({ fontSize: '14px' })
  })
})
