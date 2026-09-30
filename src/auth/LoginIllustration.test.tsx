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

const placeholder = () => screen.getByTestId('login-illustration').querySelector('svg')

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
  it('keeps the drawn platform and never loads the player when motion is reduced', async () => {
    preferReducedMotion()
    render(<LoginIllustration />)
    await settle()

    expect(placeholder()).not.toBeNull()
    expect(screen.queryByTestId('login-animation')).toBeNull()
    expect(player.imports).toBe(0)
    expect(loadAnimation).not.toHaveBeenCalled()
  })

  it('keeps the drawn platform when the player fails to load', async () => {
    player.fail = true
    render(<LoginIllustration />)
    await settle()

    expect(player.imports).toBe(1)
    expect(placeholder()).not.toBeNull()
    expect(screen.queryByTestId('login-animation')).toBeNull()
    expect(loadAnimation).not.toHaveBeenCalled()
  })

  it('shows the drawn platform until the animation has drawn, then the animation', async () => {
    loadAnimation.mockReturnValue(player.anim)
    render(<LoginIllustration />)

    expect(placeholder()).not.toBeNull()
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
    expect(config.animationData).toMatchObject({ w: 750, h: 500 })
    // Loaded but not yet drawn: the platform still stands in.
    expect(placeholder()).not.toBeNull()

    act(() => player.handlers.DOMLoaded())
    expect(placeholder()).toBeNull()
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

  // Owner 2026-09-30: at 372 px the picture looked small beside the wide hero
  // column on desktop, so it grows with the viewport; the phone size is unchanged.
  it('grows with the viewport on the wide layout and keeps the phone size compact', () => {
    const { unmount } = render(<LoginIllustration />)
    expect(screen.getByTestId('login-illustration').style.maxWidth).toBe('clamp(372px, 42vw, 720px)')
    unmount()

    render(<LoginIllustration compact />)
    expect(screen.getByTestId('login-illustration').style.maxWidth).toBe('240px')
  })
})
