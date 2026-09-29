/**
 * The login screen's animation and its player, in one module so that the one
 * dynamic import of it (LoginScreen) puts both in their own chunk: nothing
 * past the login screen ever downloads them, and a reduced-motion visitor
 * never does either.
 *
 * Animation: "Free construction Animation" by Lakhwinder, from LottieFiles
 * (https://lottiefiles.com/free-animation/construction-g8Hve0ildf), free to use
 * under the Lottie Simple License (https://lottiefiles.com/page/license). Its
 * frames are raster images, embedded in the JSON as data URIs, with their
 * colours as published (owner, 2026-09-30).
 *
 * The light build of lottie-web: SVG renderer only, no expressions. It draws
 * image layers, which are all this animation has.
 */
import lottie from 'lottie-web/build/player/lottie_light'
import type { AnimationItem } from 'lottie-web/build/player/lottie_light'
import animationData from '../assets/login-construction.json'

export function playLoginAnimation(container: HTMLElement): AnimationItem {
  return lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData,
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
  })
}
