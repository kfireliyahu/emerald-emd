/**
 * One call that measures what a session checking a screen used to measure by
 * hand — `window.emeraldProbe()`, in a dev build only (D-534).
 *
 * M54's units made 927 browser calls, and at least six of them wrote their own
 * contrast helper of about 2,000 characters, written again after every reload.
 * This is that helper once, over every route and theme asked for in a single
 * call: text under AA, type off the ramp, controls with no name or only a
 * placeholder, fields that are not square, platform selects and date inputs,
 * headings, and a page wider than its window. It reads the page and changes
 * nothing but the route and the theme, both put back when it is done.
 *
 * The arithmetic is exported and tested; what touches the DOM is `install`.
 */

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** `rgb(…)` or `rgba(…)` as the browser computes a colour, or null. */
export function parseColor(css: string): Rgba | null {
  const m = /rgba?\(([^)]+)\)/.exec(css)
  if (!m?.[1]) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  const [r = 0, g = 0, b = 0, a = 1] = parts
  return { r, g, b, a }
}

/** `top` laid over `under`, by `top`'s alpha. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  }
}

function luminance(c: Rgba): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

/** WCAG's contrast ratio of two opaque colours, 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The ratio AA asks of text this size: 3 for large text, else 4.5. */
export function aaFor(sizePx: number, weight: number): number {
  return sizePx >= 24 || (sizePx >= 18.66 && weight >= 700) ? 3 : 4.5
}

/**
 * The ramp's sizes from a stylesheet's custom properties: `--text-body: 14px`
 * counts, `--text-body--line-height` does not.
 */
export function rampSizes(properties: Iterable<readonly [string, string]>): number[] {
  const sizes = new Set<number>()
  for (const [name, value] of properties) {
    if (!/^--text-[a-z0-9-]+$/.test(name) || name.slice(7).includes('--')) continue
    const px = /^\s*([\d.]+)px\s*$/.exec(value)
    if (px?.[1]) sizes.add(Number(px[1]))
  }
  return [...sizes].sort((a, b) => a - b)
}

/** Heading levels in document order to the jumps that skip one (h2 → h4). */
export function headingSkips(levels: readonly number[]): string[] {
  const skips: string[] = []
  for (let i = 1; i < levels.length; i++) {
    const from = levels[i - 1] ?? 0
    const to = levels[i] ?? 0
    if (to > from + 1) skips.push(`h${String(from)} → h${String(to)}`)
  }
  return skips
}

export interface ProbeOptions {
  /** Hashes to visit, `#/formats` or `formats`; the current route when none. */
  readonly routes?: readonly string[]
  /** Themes to measure each route in; the current one when none. */
  readonly themes?: readonly ('light' | 'dark')[]
  /** What to measure inside; the whole page by default. */
  readonly root?: string
  /** How long the page must be still before it is measured, in ms. */
  readonly settleMs?: number
  /** At most this many entries per list; the count is always whole. */
  readonly limit?: number
}

interface Listed<T> {
  readonly count: number
  readonly items: readonly T[]
}

export interface ProbeResult {
  readonly route: string
  readonly theme: string
  readonly width: number
  readonly h1: readonly string[]
  readonly headingSkips: readonly string[]
  readonly lowContrast: Listed<{ text: string; ratio: number; needs: number; size: string }>
  readonly offRamp: Listed<{ text: string; size: string }>
  readonly unnamed: Listed<{ tag: string; html: string }>
  readonly placeholderOnly: Listed<{ placeholder: string }>
  readonly roundedFields: Listed<{ tag: string; radius: string; name: string }>
  readonly platformSelects: number
  readonly nativeDates: number
  readonly pageOverflowsX: boolean
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

function listed<T>(items: T[], limit: number): Listed<T> {
  return { count: items.length, items: items.slice(0, limit) }
}

function visible(el: Element): boolean {
  const cs = getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.display === 'none') return false
  const box = el.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}

function disabled(el: Element): boolean {
  return el.closest('[disabled], [aria-disabled="true"], [inert]') !== null
}

/** What is painted behind `el`: every translucent background down to an opaque one. */
function backdrop(el: Element | null): Rgba {
  const layers: Rgba[] = []
  for (let at = el; at; at = at.parentElement) {
    const c = parseColor(getComputedStyle(at).backgroundColor)
    if (c && c.a > 0) {
      layers.push(c)
      if (c.a >= 1) break
    }
  }
  let base = layers.length > 0 && (layers.at(-1)?.a ?? 0) >= 1 ? (layers.pop() as Rgba) : WHITE
  for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i] as Rgba, base)
  return base
}

function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label')?.trim()
  if (label) return label
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim()
    if (text) return text
  }
  const labels = (el as HTMLInputElement).labels
  if (labels && labels.length > 0) {
    const text = [...labels].map((l) => l.textContent?.trim() ?? '').join(' ').trim()
    if (text) return text
  }
  const own = (el.textContent ?? '').trim()
  if (own && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return own
  const alt = el.querySelector('img[alt], svg[aria-label]')
  const altText = alt?.getAttribute('alt') ?? alt?.getAttribute('aria-label')
  if (altText) return altText
  return el.getAttribute('title')?.trim() ?? ''
}

function cssProperties(): [string, string][] {
  const found: [string, string][] = []
  const walk = (rules: CSSRuleList) => {
    for (const rule of [...rules]) {
      if (rule instanceof CSSStyleRule) {
        for (const name of [...rule.style]) {
          if (name.startsWith('--text-')) found.push([name, rule.style.getPropertyValue(name)])
        }
      }
      if ('cssRules' in rule && rule.cssRules) walk(rule.cssRules as CSSRuleList)
    }
  }
  for (const sheet of [...document.styleSheets]) {
    try {
      walk(sheet.cssRules)
    } catch {
      // A sheet from another origin cannot be read; the app serves none.
    }
  }
  return found
}

const CONTROLS =
  'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=switch], [role=option], [role=radio]'
const FIELDS = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea'

function measure(root: Element, ramp: readonly number[], limit: number): Omit<ProbeResult, 'route' | 'theme' | 'width'> {
  const lowContrast: { text: string; ratio: number; needs: number; size: string }[] = []
  const offRamp: { text: string; size: string }[] = []
  const seen = new Set<Element>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const text = (node.textContent ?? '').trim()
    const el = node.parentElement
    if (!text || !el || seen.has(el) || !visible(el) || el.closest('svg, [aria-hidden="true"]')) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    const size = parseFloat(cs.fontSize)
    if (ramp.length > 0 && !ramp.includes(size)) offRamp.push({ text: text.slice(0, 60), size: cs.fontSize })
    if (disabled(el)) continue
    const back = backdrop(el)
    const fore = parseColor(cs.color)
    if (!fore) continue
    const ratio = contrast(fore.a < 1 ? over(fore, back) : fore, back)
    const needs = aaFor(size, Number(cs.fontWeight) || 400)
    if (ratio < needs) lowContrast.push({ text: text.slice(0, 60), ratio: Math.round(ratio * 100) / 100, needs, size: cs.fontSize })
  }

  const unnamed: { tag: string; html: string }[] = []
  const placeholderOnly: { placeholder: string }[] = []
  for (const el of root.querySelectorAll(CONTROLS)) {
    // A file input is named by the button that opens it.
    if (!visible(el) || el.matches('input[type=file]')) continue
    if (accessibleName(el)) continue
    const placeholder = el.getAttribute('placeholder')
    if (placeholder) placeholderOnly.push({ placeholder })
    else unnamed.push({ tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 120) })
  }

  const roundedFields: { tag: string; radius: string; name: string }[] = []
  for (const el of root.querySelectorAll(FIELDS)) {
    if (!visible(el)) continue
    const radius = getComputedStyle(el).borderTopLeftRadius
    if (parseFloat(radius) > 0) roundedFields.push({ tag: el.tagName.toLowerCase(), radius, name: accessibleName(el) || (el.getAttribute('placeholder') ?? '') })
  }

  const headings = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible)
  return {
    h1: headings.filter((h) => h.tagName === 'H1').map((h) => (h.textContent ?? '').trim().slice(0, 60)),
    headingSkips: headingSkips(headings.map((h) => Number(h.tagName.slice(1)))),
    lowContrast: listed(lowContrast, limit),
    offRamp: listed(offRamp, limit),
    unnamed: listed(unnamed, limit),
    placeholderOnly: listed(placeholderOnly, limit),
    roundedFields: listed(roundedFields, limit),
    platformSelects: [...root.querySelectorAll('select')].filter(visible).length,
    // A field a person types in, not `NativePicker`'s hidden calendar under a
    // text field — aria-hidden and never focused — which opens on a click (M55 U5).
    nativeDates: [...root.querySelectorAll('input[type=date], input[type=datetime-local], input[type=month]')]
      .filter((el) => visible(el) && el.closest('[aria-hidden="true"]') === null).length,
    pageOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }
}

/** Resolves once nothing in the page has changed for `quietMs`, or after four seconds. */
function settled(quietMs: number): Promise<void> {
  return new Promise((done) => {
    let timer = setTimeout(finish, quietMs)
    const cap = setTimeout(finish, 4000)
    const watch = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(finish, quietMs)
    })
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
    function finish() {
      watch.disconnect()
      clearTimeout(timer)
      clearTimeout(cap)
      // Two frames for the paint, or 100 ms where none come: a hidden page draws none.
      let over = false
      const once = () => {
        if (!over) (over = true), done()
      }
      requestAnimationFrame(() => requestAnimationFrame(once))
      setTimeout(once, 100)
    }
  })
}

export async function probe(options: ProbeOptions = {}): Promise<ProbeResult[]> {
  const html = document.documentElement
  const startHash = location.hash
  const startTheme = html.dataset.theme ?? 'light'
  // A colour transition would be measured half-way through a theme change.
  const still = document.createElement('style')
  still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'
  document.head.append(still)
  const quiet = options.settleMs ?? 250
  const limit = options.limit ?? 25
  const ramp = rampSizes(cssProperties())
  const routes = options.routes?.length ? options.routes : [startHash || '#/']
  const themes = options.themes?.length ? options.themes : [startTheme as 'light' | 'dark']
  const results: ProbeResult[] = []
  try {
    for (const route of routes) {
      const hash = route.startsWith('#') ? route : `#/${route.replace(/^\//, '')}`
      if (location.hash !== hash) {
        location.hash = hash
        await settled(quiet)
      }
      for (const theme of themes) {
        if (html.dataset.theme !== theme) {
          html.dataset.theme = theme
          await settled(quiet)
        }
        const root = (options.root ? document.querySelector(options.root) : null) ?? document.body
        results.push({ route: hash, theme, width: innerWidth, ...measure(root, ramp, limit) })
      }
    }
  } finally {
    html.dataset.theme = startTheme
    if (location.hash !== startHash) location.hash = startHash
    still.remove()
  }
  return results
}

declare global {
  interface Window {
    emeraldProbe?: typeof probe
  }
}

export function install(): void {
  window.emeraldProbe = probe
}
