/**
 * **The frame wears the host's colours and type, and keeps Emerald's meaning**
 * (M41 F1, D-445).
 *
 * A host that draws MCP Apps hands the view its look in `hostContext` — at
 * `ui/initialize` and again in `ui/notifications/host-context-changed`, which
 * carries only what changed: `theme` (`light` or `dark`), `styles.variables`
 * (any subset of the spec's standard names, `McpUiStyleVariableKey`) and
 * `styles.css.fonts` (`@font-face` rules). This module says which of them
 * Emerald takes and onto which of its own tokens, and checks that what carries
 * meaning still reads on the host's surface. `applyHostStyle` is the one place
 * the page is touched.
 *
 * **Taken**: surfaces, ink, hairlines, the small radii and the type families —
 * what makes text and quiet controls look native. **Kept, in every host**: the
 * accent (it marks what you can act on, D-125), the action fill, the verdict
 * and figure colours (`positive`, `negative`), the flows, the categories, and
 * the square cards and controls (`--radius-card`, `--radius-control`). A
 * host's accent, ring or status colours never replace them. Every token the
 * host leaves out keeps Emerald's value for the theme the host named (or the
 * system's, when it names none). The page under all of it is the host's in
 * every case (M41 F4): `frame.css` paints none.
 */

/** The context fields this frame reads, as MCP Apps (2026-01-26) names them. */
export interface HostContext {
  readonly theme?: 'light' | 'dark'
  readonly styles?: {
    readonly variables?: Readonly<Record<string, string | undefined>>
    readonly css?: { readonly fonts?: string }
  }
}

/** The context a host gave, read defensively: anything malformed is left out. */
export function contextOf(raw: unknown): HostContext {
  if (typeof raw !== 'object' || raw === null) return {}
  const box = raw as { theme?: unknown; styles?: unknown }
  const theme = box.theme === 'light' || box.theme === 'dark' ? box.theme : undefined
  const styles = typeof box.styles === 'object' && box.styles !== null ? (box.styles as { variables?: unknown; css?: unknown }) : undefined
  const variables: Record<string, string> = {}
  if (typeof styles?.variables === 'object' && styles.variables !== null) {
    for (const [name, value] of Object.entries(styles.variables)) {
      if (name.startsWith('--') && typeof value === 'string' && value.trim() !== '') variables[name] = value
    }
  }
  const fonts = (styles?.css as { fonts?: unknown } | undefined)?.fonts
  return {
    ...(theme === undefined ? {} : { theme }),
    ...(styles === undefined
      ? {}
      : { styles: { variables, ...(typeof fonts === 'string' && fonts.trim() !== '' ? { css: { fonts } } : {}) } }),
  }
}

/**
 * A change merged onto what the frame had: the spec says a host sends only the
 * fields that changed, and a view merges them. Variables merge name by name; a
 * new font block replaces the old one.
 */
export function mergeContext(before: HostContext, change: HostContext): HostContext {
  const theme = change.theme ?? before.theme
  const css = change.styles?.css ?? before.styles?.css
  const styles =
    change.styles === undefined
      ? before.styles
      : { variables: { ...before.styles?.variables, ...change.styles.variables }, ...(css === undefined ? {} : { css }) }
  return { ...(theme === undefined ? {} : { theme }), ...(styles === undefined ? {} : { styles }) }
}

/**
 * Each Emerald token a host may set, and the host variables that set it, the
 * first one given winning. A host's borders run strongest first (`primary`),
 * so Emerald's faint hairline takes the faintest the host names.
 */
export const HOST_TOKENS: ReadonlyArray<{ readonly token: string; readonly from: readonly string[] }> = [
  { token: '--color-background', from: ['--color-background-primary'] },
  { token: '--color-elevated', from: ['--color-background-primary'] },
  { token: '--color-surface', from: ['--color-background-secondary'] },
  { token: '--color-ink', from: ['--color-text-primary'] },
  { token: '--color-ink-secondary', from: ['--color-text-secondary'] },
  { token: '--color-ink-tertiary', from: ['--color-text-tertiary'] },
  { token: '--color-hairline', from: ['--color-border-tertiary', '--color-border-secondary', '--color-border-primary'] },
  { token: '--color-hairline-strong', from: ['--color-border-primary', '--color-border-secondary'] },
  { token: '--radius-sm', from: ['--border-radius-sm'] },
  { token: '--radius-md', from: ['--border-radius-md'] },
  { token: '--radius-lg', from: ['--border-radius-lg'] },
  { token: '--font-sans', from: ['--font-sans'] },
  { token: '--font-mono', from: ['--font-mono'] },
]

/** The tokens that carry meaning: never the host's, and checked against its surface. */
export const MEANING_TOKENS = ['--color-accent', '--color-positive', '--color-negative'] as const

/** The text a reader must read, checked with the meaning on the host's surface. */
export const TEXT_TOKENS = ['--color-ink', '--color-ink-secondary'] as const

/** Emerald's tokens set from the host's variables: only those the host gave. */
export function tokensFrom(variables: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { token, from } of HOST_TOKENS) {
    const given = from.map((name) => variables[name]).find((value) => value !== undefined && value.trim() !== '')
    if (given !== undefined) out[token] = given
  }
  return out
}

/** Whether a set of tokens includes a colour — the part a contrast check can fail. */
const takesColour = (tokens: Readonly<Record<string, string>>): boolean => Object.keys(tokens).some((token) => token.startsWith('--color-'))

// ---- contrast ----------------------------------------------------------------

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` — what a browser's computed style gives. */
export function parseColour(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1]
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
    const at = (i: number): number => parseInt(full.slice(i, i + 2), 16)
    return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) / 255 : 1 }
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value)?.[1]
  if (fn === undefined) return undefined
  const parts = fn.split(/[\s,/]+/).filter((p) => p !== '')
  if (parts.length < 3) return undefined
  const channel = (p: string): number => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p))
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
  const [r, g, b] = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)]
  if ([r, g, b, alpha].some((n) => Number.isNaN(n))) return undefined
  return { r, g, b, a: alpha }
}

/** A colour laid over another, as it is seen. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 }
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 2's contrast ratio, 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Text's floor (the `scope: ui` rule *Contrast 4.5:1 for text*). */
export const TEXT_CONTRAST = 4.5

/** Each colour that falls short of 4.5:1 on the background, with its ratio. */
export function shortfalls(background: Rgba, colours: Readonly<Record<string, Rgba>>): Array<{ token: string; ratio: number }> {
  const out: Array<{ token: string; ratio: number }> = []
  for (const [token, colour] of Object.entries(colours)) {
    const ratio = contrast(over(colour, background), background)
    if (ratio < TEXT_CONTRAST) out.push({ token, ratio: Math.round(ratio * 100) / 100 })
  }
  return out
}

// ---- the page ----------------------------------------------------------------

/** What the frame did with the host's look, for its log. */
type Applied =
  | { readonly kind: 'none'; readonly theme: 'light' | 'dark' }
  | {
      readonly kind: 'taken'
      readonly tokens: readonly string[]
      /** Each meaning and text colour's ratio on the surface, when its colours were taken. */
      readonly ratios?: Readonly<Record<string, number>>
      /** Whether that surface is the host's, or the theme's usual one the frame assumes. */
      readonly on?: 'host' | 'assumed'
    }
  | { readonly kind: 'kept'; readonly tokens: readonly string[]; readonly short: ReadonlyArray<{ token: string; ratio: number }> }

let applied: string[] = []

/**
 * Put the host's look on the page: its fonts, and its variables mapped onto
 * Emerald's tokens as inline properties on `:root` (which win over both
 * themes' values, and are taken off again when a later context drops them).
 * **The page itself is transparent whatever the host sends** (M41 F4,
 * `frame.css`): the conversation's surface is what the frame sits on.
 *
 * Then the check: Emerald's accent, verdict colours and the text must each
 * read at 4.5:1 on the surface — the host's, when it names one; otherwise the
 * one the frame assumes, the usual surface of the theme the host named, which
 * is Emerald's own `--color-background` for that theme (a frame cannot read
 * its host's page). **Where one does not, the frame keeps Emerald's colours
 * whole** rather than let a host's surface swallow a verdict, and where the
 * host named the surface it paints its own over it (`data-own-surface`). Type
 * and radii are taken either way. Call after the theme is on the page, so
 * `light-dark()` values resolve to the right side.
 */
export function applyHostStyle(context: HostContext, doc: Document = document): Applied {
  const root = doc.documentElement
  const fonts = context.styles?.css?.fonts
  let fontStyle = doc.getElementById('host-fonts')
  if (fonts === undefined) fontStyle?.remove()
  else {
    if (fontStyle === null) {
      fontStyle = doc.createElement('style')
      fontStyle.id = 'host-fonts'
      doc.head.appendChild(fontStyle)
    }
    // A rule whose file the frame's CSP refuses (D-433: no request leaves the
    // frame) fails quietly, and the family falls back down `--font-sans`.
    if (fontStyle.textContent !== fonts) fontStyle.textContent = fonts
  }

  const tokens = tokensFrom(context.styles?.variables ?? {})
  for (const name of applied) if (!(name in tokens)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
  applied = Object.keys(tokens)
  delete root.dataset.ownSurface
  if (applied.length === 0) return { kind: 'none', theme: root.dataset.theme === 'dark' ? 'dark' : 'light' }
  if (!takesColour(tokens)) return { kind: 'taken', tokens: applied }

  const background = resolved(doc, 'var(--color-background)') ?? { r: 255, g: 255, b: 255, a: 1 }
  const colours: Record<string, Rgba> = {}
  for (const token of [...MEANING_TOKENS, ...TEXT_TOKENS]) {
    const colour = resolved(doc, `var(${token})`)
    if (colour !== undefined) colours[token] = colour
  }
  const short = shortfalls(background, colours)
  if (short.length > 0) {
    if ('--color-background' in tokens) root.dataset.ownSurface = ''
    for (const name of applied) if (name.startsWith('--color-')) root.style.removeProperty(name)
    applied = applied.filter((name) => !name.startsWith('--color-'))
    return { kind: 'kept', tokens: applied, short }
  }
  const ratios = Object.fromEntries(
    Object.entries(colours).map(([token, colour]) => [token, Math.round(contrast(over(colour, background), background) * 100) / 100]),
  )
  return { kind: 'taken', tokens: applied, ratios, on: '--color-background' in tokens ? 'host' : 'assumed' }
}

/**
 * A colour as the page sees it: through a probe's computed style, which
 * resolves `var()` and `light-dark()`, then a canvas for any notation the
 * computed style leaves as written (`oklch()`, `color()`).
 */
function resolved(doc: Document, value: string): Rgba | undefined {
  const probe = doc.createElement('span')
  probe.style.color = value
  probe.style.display = 'none'
  doc.body.appendChild(probe)
  const computed = doc.defaultView?.getComputedStyle(probe).color ?? ''
  probe.remove()
  const parsed = parseColour(computed)
  if (parsed !== undefined) return parsed
  const context = doc.createElement('canvas').getContext('2d')
  if (context === null) return undefined
  context.fillStyle = '#000'
  context.fillStyle = computed
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return r === undefined ? undefined : { r, g: g ?? 0, b: b ?? 0, a: (a ?? 255) / 255 }
}

/** The line the frame says in the host's log about its look. */
export function describeApplied(applied: Applied): string {
  switch (applied.kind) {
    case 'none':
      return (
        `The host named no colours: the page is transparent, and Emerald's ${applied.theme} theme assumes the host's surface is that theme's usual one ` +
        `(its text and verdicts clear 4.5:1 on Emerald's own ${applied.theme} surface; the host's cannot be measured).`
      )
    case 'taken':
      return (
        `Wearing the host's ${applied.tokens.join(', ')}; the accent and the verdict colours stay Emerald's` +
        (applied.ratios === undefined
          ? '.'
          : `, on ${applied.on === 'assumed' ? "the theme's usual surface (assumed: the host named none)" : "the host's surface"}: ` +
            `${Object.entries(applied.ratios).map(([token, ratio]) => `${token} ${String(ratio)}:1`).join(', ')}.`)
      )
    case 'kept':
      return (
        `Keeping Emerald's own colours: on the host's surface ${applied.short.map((s) => `${s.token} reads at ${String(s.ratio)}:1`).join(', ')}, under 4.5:1.` +
        (applied.tokens.length > 0 ? ` Wearing the host's ${applied.tokens.join(', ')}.` : '')
      )
  }
}

/**
 * **What the host handed in `hostContext`, said in its log** (M41 F4), so a
 * host this machine cannot open is measured by the person who can: the theme,
 * every style variable's name, the colour each one Emerald reads resolves to
 * on this page, whether fonts came, and how many `--vscode-*` variables VS
 * Code's webview put on the page itself.
 */
export function describeContext(
  context: HostContext,
  resolvedColours: Readonly<Record<string, string>>,
  pageVariables: number,
): string {
  const names = Object.keys(context.styles?.variables ?? {})
  const read = Object.entries(resolvedColours)
  return (
    `Host context: theme ${context.theme ?? 'not named'}; ` +
    (context.styles === undefined
      ? 'no styles'
      : `${String(names.length)} style variables${names.length === 0 ? '' : ` (${names.join(', ')})`}`) +
    (read.length === 0 ? '' : `; the ones Emerald reads resolve to ${read.map(([name, colour]) => `${name} ${colour}`).join(', ')}`) +
    `; fonts ${context.styles?.css?.fonts === undefined ? 'none' : 'given'}` +
    `; --vscode-* variables on the page: ${String(pageVariables)}.`
  )
}

/** `describeContext` for this page: the colours Emerald reads, resolved here. */
export function handedLine(context: HostContext, doc: Document = document): string {
  const variables = context.styles?.variables ?? {}
  const colours: Record<string, string> = {}
  for (const name of new Set(HOST_TOKENS.flatMap((entry) => entry.from))) {
    const value = variables[name]
    if (!name.startsWith('--color-') || value === undefined) continue
    const colour = resolved(doc, value)
    colours[name] = colour === undefined ? value : hexOf(colour)
  }
  let page = 0
  const style = doc.documentElement.style
  for (let i = 0; i < style.length; i++) if (style[i]?.startsWith('--vscode-') === true) page++
  return describeContext(context, colours, page)
}

/** A colour as `#rrggbb`, or `#rrggbbaa` when it is not opaque. */
export function hexOf({ r, g, b, a }: Rgba): string {
  const two = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
  return `#${two(r)}${two(g)}${two(b)}${a < 1 ? two(a * 255) : ''}`
}
