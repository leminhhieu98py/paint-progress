import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginIllustration } from './LoginScreen'

vi.mock('./AuthProvider', () => ({ useAuth: () => ({}) }))

// The player is faked: jsdom has no layout for lottie to draw into, and what is
// under test is when the player is loaded, started, paused and destroyed.
// `imports` counts how many times the player module was actually loaded in
// this test, so a test can prove it never was.
const player = vi.hoisted(() => {
  const handlers: Record<string, () => void> = {}
  const anim = {
    addEventListener: (name: string, cb: () => void) => {
      handlers[name] = cb
    },
    play: () => {},
    pause: () => {},
    goToAndStop: () => {},
    destroy: () => {},
  }
  return { imports: 0, fail: false, handlers, anim }
})
const loadAnimation = vi.hoisted(() => vi.fn())

vi.mock('lottie-web/build/player/lottie_light', () => {
  player.imports += 1
  if (player.fail) throw new Error('chunk failed to load')
  return { default: { loadAnimation } }
})

const originalMatchMedia = window.matchMedia

function preferReducedMotion() {
  window.matchMedia = ((query: string) => ({
    ...originalMatchMedia(query),
    matches: query === '(prefers-reduced-motion: reduce)',
  })) as typeof window.matchMedia
}

let hidden = false
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })

function setHidden(next: boolean) {
  hidden = next
  document.dispatchEvent(new Event('visibilitychange'))
}

async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled()
  })
}

// Anything drawn in the box other than the player's own host.
const standIn = () => screen.getByTestId('login-illustration').querySelector(':scope > :not([data-testid="login-animation"])')

// A fresh module registry per test: the component's dynamic import then loads
// (or fails to load) the player anew each time, instead of reusing whatever an
// earlier test left cached -- a failed load included.
beforeEach(() => {
  vi.resetModules()
  player.imports = 0
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
  hidden = false
  player.fail = false
  for (const key of Object.keys(player.handlers)) delete player.handlers[key]
  loadAnimation.mockReset()
  vi.restoreAllMocks()
})

describe('LoginIllustration', () => {
  // First in the file on purpose: vi.resetModules does not run the player
  // mock's factory again once a test has loaded it, so the failed load has to
  // be the first load of the player in this file.
  it('keeps the box empty when the player fails to load', async () => {
    player.fail = true
    render(<LoginIllustration />)
    await settle()

    expect(player.imports).toBe(1)
    expect(screen.getByTestId('login-illustration')).toBeInTheDocument()
    expect(standIn()).toBeNull()
    expect(screen.queryByTestId('login-animation')).toBeNull()
    expect(loadAnimation).not.toHaveBeenCalled()
  })

  // RV7-1d: a visitor who asks for reduced motion sees one still frame of the
  // animation instead of nothing; it never plays, not even when the tab is shown.
  it('shows one still frame and never plays when motion is reduced', async () => {
    preferReducedMotion()
    loadAnimation.mockReturnValue(player.anim)
    const goToAndStop = vi.spyOn(player.anim, 'goToAndStop')
    const play = vi.spyOn(player.anim, 'play')
    const destroy = vi.spyOn(player.anim, 'destroy')
    const { unmount } = render(<LoginIllustration />)
    await settle()

    expect(loadAnimation).toHaveBeenCalledTimes(1)
    expect(loadAnimation.mock.calls[0][0]).toMatchObject({ loop: false, autoplay: false })
    expect(goToAndStop).toHaveBeenCalledWith(60, true)

    act(() => player.handlers.DOMLoaded())
    expect(screen.getByTestId('login-animation')).toBeVisible()
    setHidden(true)
    setHidden(false)
    expect(play).not.toHaveBeenCalled()

    // Gone with the screen, as the playing animation is.
    unmount()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps the box empty until the animation has drawn, then shows the animation', async () => {
    loadAnimation.mockReturnValue(player.anim)
    const goToAndStop = vi.spyOn(player.anim, 'goToAndStop')
    render(<LoginIllustration />)

    expect(standIn()).toBeNull()
    const host = screen.getByTestId('login-animation')
    expect(host).not.toBeVisible()

    await settle()
    expect(loadAnimation).toHaveBeenCalledTimes(1)
    const config = loadAnimation.mock.calls[0][0]
    expect(config).toMatchObject({
      container: host,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    })
    // "Businessmen at the table" (RV7-1b): a square 500 x 500.
    expect(config.animationData).toMatchObject({ w: 500, h: 500 })
    expect(goToAndStop).not.toHaveBeenCalled()
    expect(host).not.toBeVisible()

    act(() => player.handlers.DOMLoaded())
    expect(standIn()).toBeNull()
    expect(screen.getByTestId('login-animation')).toBeVisible()
    expect(screen.getByTestId('login-illustration')).toHaveAttribute('aria-hidden', 'true')
  })

  it('destroys the animation when the login screen goes away', async () => {
    loadAnimation.mockReturnValue(player.anim)
    const destroy = vi.spyOn(player.anim, 'destroy')
    const { unmount } = render(<LoginIllustration />)
    await settle()

    unmount()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('never starts an animation for a screen that left before the player loaded', async () => {
    loadAnimation.mockReturnValue(player.anim)
    const { unmount } = render(<LoginIllustration />)
    unmount()
    await settle()

    expect(loadAnimation).not.toHaveBeenCalled()
  })

  it('pauses while the page is hidden and plays again when it is shown', async () => {
    loadAnimation.mockReturnValue(player.anim)
    const pause = vi.spyOn(player.anim, 'pause')
    const play = vi.spyOn(player.anim, 'play')
    const { unmount } = render(<LoginIllustration />)
    await settle()

    setHidden(true)
    expect(pause).toHaveBeenCalledTimes(1)
    setHidden(false)
    expect(play).toHaveBeenCalledTimes(1)

    // Gone with the screen: no listener left behind to wake a destroyed player.
    unmount()
    setHidden(true)
    setHidden(false)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('starts paused when the login screen opens in a hidden tab', async () => {
    hidden = true
    loadAnimation.mockReturnValue(player.anim)
    const pause = vi.spyOn(player.anim, 'pause')
    render(<LoginIllustration />)
    await settle()

    expect(pause).toHaveBeenCalledTimes(1)
  })

  // RV7-1c: the animation is square, so is its box. Large on the wide layout
  // but never taller than 70vh, so the form beside it stays in view: the
  // width is held to 70vh rather than the height, so the box stays square.
  it('sizes a square box, large on the wide layout and compact on a phone', () => {
    const { unmount } = render(<LoginIllustration />)
    const wide = screen.getByTestId('login-illustration').style
    expect(wide.aspectRatio).toBe('1 / 1')
    expect(wide.width).toBe('min(100%, 70vh)')
    expect(wide.maxWidth).toBe('clamp(320px, 34vw, 560px)')
    expect(wide.maxHeight).toBe('')
    unmount()

    render(<LoginIllustration compact />)
    const compact = screen.getByTestId('login-illustration').style
    expect(compact.aspectRatio).toBe('1 / 1')
    expect(compact.maxWidth).toBe('200px')
  })
})
