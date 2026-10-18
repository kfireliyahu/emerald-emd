import '@/ui/theme/tokens.css'
import './page.css'
import { CORE, FACETS, GLINTS } from '@/ui/gem.ts'
import { initTheme, setThemePreference, type ThemePreference } from '@/ui/theme/useTheme.ts'
import { mountClaim } from './claim.ts'
import { mountInbox } from './inbox.ts'
import { mountReel } from './reel.ts'
import { fill, LANGUAGES, pickLanguage, rememberLanguage, type Copy } from './copy.ts'
import { COUNT_SCRIPT, CONTACT, DEVELOPMENT_RECORDING, FORM_ACTION, SOURCE_URL } from './page.ts'
import { rowAt, tones } from './rail.ts'

/**
 * **Emerald's page** (M33 U8, D-459): `demo-page.html`, which the demo build
 * writes as `dist-demo/index.html` — the root of the folder Pages serves and
 * getemerald.dev points at. The four tours are the frame beside it,
 * `tour.html`, embedded by its own contract (M33 U4: `?tour=` and
 * `?autoplay=1`, no referrer, an empty allow list), and nothing on this page
 * explains the engine: the frames' captions do the talking.
 *
 * The page is laid out as the app (2026-10-12, on the mockup
 * M33 U8a): the timeline down the left in the sidebar's plane, every section a
 * row of it, solid to the row under the eye and dashed after, that row's dot
 * live in accent and pulsing once on arrival, and the address following the
 * row. The dots are the app's own (`.fc-tl-dot` and `.fc-dot` from tokens.css,
 * the tones of `src/ui/formats/tone.ts`); the growing line is the page's. Below
 * 960 px the rail is a strip across the top.
 *
 * **The words are `copy/<language>.ts`** (M33 F9): the markup names keys, and
 * `fill` puts the words in, in the language `pickLanguage` chose.
 *
 * Nothing leaves the page but the frames' requests to the folder it is served
 * from (`check:tours` refuses anything else). What it may reach for one day —
 * a form post, a count — is off, and `page.ts` says why.
 */

declare global {
  interface Window {
    /** For `scripts/check-tours-window.cjs`: how many frames are loaded (those near the view), and how many of them have stepped. */
    emeraldPageCheck?: { readonly frames: number; readonly stepped: number }
  }
}

initTheme()
requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'))
document.documentElement.classList.add('js')

// The words, in the language chosen; the page reads in its direction.
const copy: Copy = pickLanguage()
document.documentElement.lang = copy.lang
document.documentElement.dir = copy.dir
fill(document, copy)

// The switch between languages, only once there is more than one.
const languages = document.getElementById('languages')
if (languages && LANGUAGES.length > 1) {
  languages.hidden = false
  languages.setAttribute('aria-label', copy.rail.language)
  for (const each of LANGUAGES) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = each.name
    button.lang = each.lang
    button.disabled = each.lang === copy.lang
    button.addEventListener('click', () => {
      rememberLanguage(each.lang)
      const url = new URL(location.href)
      url.searchParams.set('lang', each.lang)
      location.href = url.href
    })
    languages.append(button)
  }
}

// The theme: a plain toggle (2026-10-12). The page follows the
// system until pressed; a press switches to the other scheme and keeps it,
// under the key the app keeps its own (`fc-theme`). The icon is what a press
// does — the moon in light, the sun in dark — and so is the label.
const themeButton = document.getElementById('theme')
if (themeButton) {
  const show = (): void => {
    const dark = document.documentElement.dataset.theme === 'dark'
    themeButton.dataset.theme = dark ? 'dark' : 'light'
    themeButton.setAttribute('aria-label', dark ? copy.rail.theme.toLight : copy.rail.theme.toDark)
    themeButton.setAttribute('title', dark ? copy.rail.theme.toLight : copy.rail.theme.toDark)
    themeButton.querySelector('use')?.setAttribute('href', dark ? '#i-light' : '#i-dark')
  }
  themeButton.addEventListener('click', () => {
    const next: ThemePreference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    setThemePreference(next)
    show()
  })
  show()
  // Following the system, until pressed: a change of the machine's own scheme redraws the icon.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(show))
}

// The hero's mark assembles from its facets, once, the way the progress
// indicator's does (`Working.tsx`, `gem.ts`): each facet flies in from along
// its own cut, in the order the mark is made. The still mark is the fallback.
const gem = document.getElementById('gem')
if (gem) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 64 64')
  svg.setAttribute('class', 'fc-gem page-gem')
  svg.setAttribute('aria-hidden', 'true')
  const place = (element: SVGElement, index: number, dx: number, dy: number): void => {
    element.setAttribute('class', 'fc-facet')
    element.style.setProperty('--i', String(index))
    element.style.setProperty('--dx', `${String(dx)}px`)
    element.style.setProperty('--dy', `${String(dy)}px`)
  }
  svg.innerHTML =
    '<defs><linearGradient id="page-gem-core" x1="25.448" y1="18.4592" x2="38.9888" y2="45.5408" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#E8FCF2"/><stop offset="1" stop-color="#34D399"/></linearGradient></defs>'
  FACETS.forEach((facet, index) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', facet.d)
    path.setAttribute('fill', facet.fill)
    place(path, index, facet.dx, facet.dy)
    svg.append(path)
  })
  const core = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  place(core, FACETS.length, 0, 0)
  core.innerHTML =
    `<path d="${CORE}" fill="url(#page-gem-core)"/>` +
    GLINTS.map(([d, opacity]) => `<path d="${d}" fill="white" fill-opacity="${String(opacity)}"/>`).join('')
  svg.append(core)
  gem.replaceChildren(svg)
}

// The claim that plays itself, where the recording will go.
const claim = document.getElementById('claim')
if (claim) mountClaim(claim, copy.engine.claim)

// The inbox across projects, playing itself (M33 F11), and its
// recording beside it once there is one: never a file the page does not have.
// The ledger's screens as a reel (M33 F12).
const shots = document.getElementById('shots')
if (shots) mountReel(shots, copy.shots)

const inbox = document.getElementById('inbox')
if (inbox) mountInbox(inbox, copy.inbox)
const recording = document.getElementById('recording')
if (recording && DEVELOPMENT_RECORDING !== '') {
  const video = document.createElement('video')
  video.src = DEVELOPMENT_RECORDING
  video.controls = true
  video.muted = true
  video.preload = 'metadata'
  video.playsInline = true
  video.width = 1920
  video.height = 1080
  video.loop = true
  recording.prepend(video)
  recording.hidden = false
  // Round and round while it is on screen, as the reel goes; still under reduced
  // motion, where the controls start it.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => undefined)
        else video.pause()
      },
      { threshold: 0.35 },
    ).observe(video)
  }
}

// The frames: the tour page beside this one, one per tour. A frame is the whole
// app with a tour running in it, and four of them share this page's process,
// so a frame is loaded when it comes within half a window of the view and let
// go when it leaves it. Loaded is not playing: the frame holds its first step
// until it is seen and pauses while it is not (M42 F1, D-496, `seen.ts`), so a
// tour scrolled down to starts at its beginning, one scrolled past a little
// goes on where it stopped, and one let go starts again, as it would at the loop.
const frames = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-tour]')]
const loaded = new Set<HTMLIFrameElement>()
const stepped = new Set<MessageEventSource>()
function publish(): void {
  window.emeraldPageCheck = { frames: loaded.size, stepped: stepped.size }
}
const nearby = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const frame = entry.target as HTMLIFrameElement
      if (entry.isIntersecting && !loaded.has(frame)) {
        frame.src = `./tour.html?tour=${encodeURIComponent(frame.dataset.tour ?? '')}&autoplay=1`
        loaded.add(frame)
      } else if (!entry.isIntersecting && loaded.has(frame)) {
        frame.removeAttribute('src')
        loaded.delete(frame)
        if (frame.contentWindow) stepped.delete(frame.contentWindow)
      }
    }
    publish()
  },
  { rootMargin: '50% 0px 50% 0px' },
)
for (const frame of frames) nearby.observe(frame)
publish()

// What the frames say, and nothing else is listened for: a step from each
// loaded frame is what `check:tours` waits on. The sender is kept as the
// proxy it arrives as — a frame's window is never `instanceof Window` here.
window.addEventListener('message', (event) => {
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null || event.source === null) return
  const { source, event: kind } = data as { source?: unknown; event?: unknown }
  if (source !== 'emerald-demo' || kind !== 'step') return
  stepped.add(event.source)
  publish()
})

// The roadmap: one row per section, named by the copy, drawn into the rail and the strip.
const rows = [...document.querySelectorAll<HTMLElement>('.row[data-row]')]
const rail = document.getElementById('tl')
const strip = document.getElementById('strip')
const solid = document.getElementById('solid')
const now = document.getElementById('now')
if (!rail || !strip || !solid || !now) throw new Error('the rail is missing from the page')
const nameOf = (row: HTMLElement): string => copy.rows[row.id] ?? row.id
const items = rows.map((row, index) => {
  const item = document.createElement('li')
  item.dataset.tone = 'waiting'
  item.style.setProperty('--i', String(index))
  const ref = String(index + 1).padStart(2, '0')
  item.innerHTML =
    `<a href="#${row.id}"><span class="cell"><span class="fc-tl-dot fc-pulse" aria-hidden="true"></span></span>` +
    `<span class="name"><span class="ref">${ref}</span></span></a>`
  item.querySelector('.name')?.append(nameOf(row))
  rail.append(item)
  const small = document.createElement('li')
  small.dataset.tone = 'waiting'
  small.innerHTML = `<a href="#${row.id}"><span class="fc-dot"></span></a>`
  const link = small.querySelector('a')
  link?.setAttribute('title', nameOf(row))
  link?.setAttribute('aria-label', nameOf(row))
  strip.append(small)
  return { item, small, dot: item.querySelector<HTMLElement>('.fc-tl-dot') }
})

// Where the reader is, and what follows from it: the tones, the solid line to
// the live dot, one pulse of that dot, and the address — replaced, never
// pushed, so Back still leaves the page rather than walking the rows. The
// class alternates so a second arrival at a row replays the pulse, as a
// changed row's does on the roadmap.
let at = -1
let pulse: 'a' | 'b' = 'b'
function place(): void {
  const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2
  const current = rowAt(
    rows.map((row) => row.getBoundingClientRect().top),
    window.innerHeight * 0.4,
    atEnd,
  )
  if (current === at || current === -1 || !rail || !solid || !now) return
  const first = at === -1
  at = current
  tones(items.length, at).forEach((tone, index) => {
    const { item, small, dot } = items[index] as (typeof items)[number]
    item.dataset.tone = tone
    small.dataset.tone = tone
    if (dot) dot.dataset.tone = tone
    dot?.classList.remove('fc-pulse-a', 'fc-pulse-b')
  })
  pulse = pulse === 'a' ? 'b' : 'a'
  items[at]?.dot?.classList.add(`fc-pulse-${pulse}`)
  const origin = rail.getBoundingClientRect().top
  const centre = (index: number): number => (items[index]?.dot?.getBoundingClientRect().top ?? origin) - origin + 9
  solid.style.top = `${String(centre(0))}px`
  solid.style.height = `${String(centre(at) - centre(0))}px`
  const row = rows[at]
  now.textContent = row ? `· ${nameOf(row)}` : ''
  if (!first && row) {
    const address = at === 0 ? `${location.pathname}${location.search}` : `#${row.id}`
    history.replaceState(null, '', address)
  }
}

// A row fades in the first time it is reached, and nothing else moves.
function reveal(): void {
  const edge = window.innerHeight * 0.9
  for (const row of rows) if (!row.classList.contains('seen') && row.getBoundingClientRect().top < edge) row.classList.add('seen')
}

let ticking = false
const onScroll = (): void => {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    ticking = false
    place()
    reveal()
  })
}
window.addEventListener('scroll', onScroll, { passive: true })
window.addEventListener('resize', onScroll)
place()
reveal()

// The foot: the form only when there is somewhere for it to go; the contact address otherwise.
const form = document.querySelector<HTMLFormElement>('.foot form')
const instead = document.querySelector<HTMLElement>('.foot .instead')
if (form && instead) {
  if (FORM_ACTION === '') {
    form.hidden = true
    instead.hidden = false
    const link = instead.querySelector<HTMLAnchorElement>('a')
    if (link) {
      link.href = `mailto:${CONTACT}`
      link.textContent = CONTACT
    }
  } else {
    form.action = FORM_ACTION
    form.method = 'post'
  }
}
if (COUNT_SCRIPT !== '') {
  const script = document.createElement('script')
  script.src = COUNT_SCRIPT
  script.async = true
  document.body.append(script)
}
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-source]')) link.href = SOURCE_URL
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-privacy]')) link.href = `${SOURCE_URL}/blob/main/PRIVACY.md`
