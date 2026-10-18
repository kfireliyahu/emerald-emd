import type { Copy } from './copy.ts'

/**
 * **The ledger's screens as a reel** (M33 F12), after an
 * existing site's reel: the pictures stacked in one frame, a row of numbered
 * steps under it whose bars fill while their picture is shown, and the next
 * picture after a while, round and round — only while the reel is on screen and
 * the tab is shown. A step shows its picture and the round carries on from
 * there; the button, or a click on the frame, pauses and plays. Under reduced
 * motion nothing moves by itself: the first picture stays until a step is
 * picked. Without script the first picture shows alone, as the markup has it.
 */

/** How long a picture is shown before the next, in milliseconds. */
const DWELL_MS = 6000

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

export function mountReel(reel: HTMLElement, words: Copy['shots']): void {
  const slides = [...reel.querySelectorAll<HTMLElement>('[data-slide]')]
  const steps = [...reel.querySelectorAll<HTMLButtonElement>('[data-step-to]')]
  const toggle = reel.querySelector<HTMLButtonElement>('[data-reel-toggle]')
  const frame = reel.querySelector<HTMLElement>('.reel-frame')
  const caption = reel.querySelector<HTMLElement>('[data-reel-caption]')
  if (slides.length === 0 || toggle === null || frame === null) return
  const captions = [words.split, words.whereitwent, words.wealth, words.year].map((shot) => shot.caption)

  let at = 0
  /** Paused by the reader, or not yet started under reduced motion. */
  let paused = reduced.matches
  /** Enough of it on screen to be worth moving. */
  let seen = false
  /** How much of the current picture's time has gone, and since when it has been running. */
  let spent = 0
  let since = 0
  let raf = 0

  const running = (): boolean => seen && !paused && !document.hidden
  const share = (): number => Math.min(1, (spent + (since === 0 ? 0 : performance.now() - since)) / DWELL_MS)

  // The bars: the steps before the current one full, the current one as far as its time has gone.
  const fill = (): void => {
    const p = share()
    steps.forEach((step, k) => step.style.setProperty('--p', String(k < at ? 1 : k === at ? p : 0)))
  }

  const tick = (): void => {
    fill()
    if (share() >= 1) {
      show(at + 1)
      return
    }
    raf = requestAnimationFrame(tick)
  }

  // Runs the clock if it may, else holds it where it is.
  const sync = (): void => {
    cancelAnimationFrame(raf)
    if (running()) {
      if (since === 0) since = performance.now()
      raf = requestAnimationFrame(tick)
    } else if (since !== 0) {
      spent += performance.now() - since
      since = 0
    }
    toggle.textContent = paused ? words.play : words.pause
    toggle.setAttribute('aria-pressed', String(paused))
    fill()
  }

  const show = (k: number): void => {
    at = (k + slides.length) % slides.length
    slides.forEach((slide, j) => slide.classList.toggle('is-current', j === at))
    steps.forEach((step, j) => step.setAttribute('aria-pressed', String(j === at)))
    if (caption !== null) caption.textContent = captions[at] ?? ''
    spent = 0
    since = 0
    sync()
  }

  for (const step of steps) {
    step.addEventListener('click', () => {
      paused = false
      show(Number(step.dataset.stepTo))
    })
  }
  const flip = (): void => {
    paused = !paused
    sync()
  }
  toggle.addEventListener('click', flip)
  frame.addEventListener('click', (event) => {
    if (event.target !== toggle) flip()
  })

  new IntersectionObserver(
    ([entry]) => {
      seen = entry?.isIntersecting ?? false
      sync()
    },
    { threshold: 0.35 },
  ).observe(reel)
  document.addEventListener('visibilitychange', sync)

  reel.classList.add('reel-live')
  show(0)
}
