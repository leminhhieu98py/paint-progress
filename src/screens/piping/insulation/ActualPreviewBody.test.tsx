import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderApp } from '../../../test/renderApp'
import { setViewport } from '../../../test/viewport'
import { ActualPreviewBody } from './ActualPreviewBody'
import type { ActualPreview } from './actualPreview'

const PREVIEW: ActualPreview = {
  save: 0,
  overwriteSpools: 1,
  overwrites: [{ key: 'k1', spoolId: 's1', spoolNo: 'SP-1', milestone: 'ph', from: '2026-10-01', to: '2026-10-02' }],
  skipped: [],
  unchanged: 0,
}

const overwriteTable = () => within(screen.getByRole('region', { name: 'Ngày Actual bị ghi đè' })).getByRole('table')
  .closest('.ant-table') as HTMLElement
const spoolCell = () => within(overwriteTable()).getByText('SP-1').closest('td') as HTMLElement

let undoViewport = () => {}
afterEach(() => undoViewport())

describe('ActualPreviewBody: overwrite table (MOB-01)', () => {
  it('scrolls sideways when wide', () => {
    undoViewport = setViewport(1280)
    renderApp(<ActualPreviewBody preview={PREVIEW} overwrite={false} onOverwrite={() => {}} />)
    expect(overwriteTable()).toHaveClass('ant-table-scroll-horizontal')
    expect(spoolCell()).not.toHaveClass('ant-table-cell-fix-left')
  })

  it('keeps the SpoolNo in view on a phone', () => {
    undoViewport = setViewport(390)
    renderApp(<ActualPreviewBody preview={PREVIEW} overwrite={false} onOverwrite={() => {}} />)
    expect(spoolCell()).toHaveClass('ant-table-cell-fix-left')
  })
})
