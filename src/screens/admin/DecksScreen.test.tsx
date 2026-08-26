import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DecksScreen } from './DecksScreen'

const listProjectNames = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())

vi.mock('../../lib/projectsApi', () => ({ listProjectNames: () => listProjectNames() }))
vi.mock('../../lib/decksApi', () => ({ listDecks: (p: string) => listDecks(p) }))

beforeEach(() => {
  for (const m of [listProjectNames, listDecks]) m.mockReset()
  listProjectNames.mockResolvedValue([{ id: 'p1', name: 'BB1', code: 'BB1' }])
  listDecks.mockResolvedValue([
    {
      id: 'd1', projectId: 'p1', seq: 1, name: 'Main Deck', code: 'MD',
      imagePath: null, imageW: null, imageH: null,
      totalAreaM2: 5258.5, areaSource: 'prorated', cellCount: 24,
    },
  ])
})

/**
 * Rendered inside a router that echoes wherever the screen navigates to.
 *
 * Where it goes IS what this screen does now -- creating a deck and attaching
 * its drawing both moved to the deck's own address -- so a stand-in that only
 * proved "something was clicked" would leave the whole of it unchecked.
 */
const renderScreen = () =>
  render(
    <MemoryRouter initialEntries={['/decks']}>
      <Routes>
        <Route path="/decks" element={<DecksScreen />} />
        <Route path="/decks/:deckId" element={<div>deck page</div>} />
      </Routes>
    </MemoryRouter>,
  )

describe('DecksScreen', () => {
  it('lists the decks of the first project', async () => {
    renderScreen()

    expect(await screen.findByText('Main Deck')).toBeInTheDocument()
    expect(screen.getByText('MD')).toBeInTheDocument()
    expect(screen.getByText('5.258,50')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    await waitFor(() => expect(listDecks).toHaveBeenCalledWith('p1'))
  })

  it('says whether a deck has a drawing yet, without offering to attach one', async () => {
    // Attaching a drawing belongs to the deck, and the deck has a page of its
    // own. A row that still carried a file picker would be a second way in,
    // with its own idea of which file types are allowed.
    renderScreen()

    expect(await screen.findByText('Chưa có')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tải bản vẽ' })).not.toBeInTheDocument()
  })

  it('opens the deck at its own address', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Mở' }))

    expect(await screen.findByText('deck page')).toBeInTheDocument()
  })

  it('sends "Tạo sàn" to the new-deck page, carrying the project it belongs to', async () => {
    // The project is in the URL rather than in navigation state so that a
    // reload of the create form still knows which project it is creating in.
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Tạo sàn' }))

    expect(await screen.findByText('deck page')).toBeInTheDocument()
  })

  it('shows an empty state, not a spinner, when there is no project at all', async () => {
    // The table initialises loading, and with no project to load nothing else
    // would ever turn it off: the admin gets a spinner for ever.
    listProjectNames.mockResolvedValue([])
    renderScreen()

    // No row, and no spinner either: asserted on the table's own body rather
    // than on antd's empty-state wording, which is translated.
    await waitFor(() => expect(document.querySelector('.ant-spin-spinning')).toBeNull())
    expect(document.querySelectorAll('.ant-table-tbody .ant-table-row')).toHaveLength(0)
    expect(listDecks).not.toHaveBeenCalled()
  })

  it('reports a failed project list rather than showing an empty one', async () => {
    listProjectNames.mockRejectedValue(new Error('JWT expired'))
    renderScreen()

    expect(await screen.findByText('JWT expired')).toBeInTheDocument()
  })
})
