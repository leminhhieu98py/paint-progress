/**
 * The login screen's animation and its player, in one module so that the one
 * dynamic import of it (LoginScreen) puts both in their own chunk: nothing
 * past the login screen ever downloads them.
 *
 * Animation: "Businessmen at the table" by Alexander Rozhkov, from LottieFiles,
 * free for commercial use under the Lottie Simple License
 * (https://lottiefiles.com/page/license), no attribution required (Feedback
 * Rv7, RV7-1b). Copied verbatim: 500 x 500 shape layers, no images, no
 * expressions, no external URLs.
 *
 * The light build of lottie-web: SVG renderer only, no expressions engine,
 * which this file does not need. Its gradient fills and trim paths are drawn
 * by the light build.
 */
import lottie from 'lottie-web/build/player/lottie_light'
import type { AnimationItem } from 'lottie-web/build/player/lottie_light'
import animationData from '../assets/login-businessmen.json'

/** The frame a reduced-motion visitor sees, held still (RV7-1d). */
const STILL_FRAME = 60

/**
 * Plays the animation in `container`, looping; `still` (reduced motion) loads
 * it without playing and holds one frame instead.
 */
export function playLoginAnimation(container: HTMLElement, { still = false } = {}): AnimationItem {
  const animation = lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: !still,
    autoplay: !still,
    animationData,
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
  })
  if (still) animation.goToAndStop(STILL_FRAME, true)
  return animation
}
