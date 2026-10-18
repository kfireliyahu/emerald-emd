import { en } from './copy/en.ts'

/**
 * **Every word on Emerald's page lives in one file per language** (M33 F9,
 * 2026-10-12: the text is changed by hand, so it is in one place,
 * and the page takes other languages). `copy/en.ts` is English, and the shape
 * every language fills; a second language is a copy of that file translated,
 * added to `LANGUAGES` below, with `dir: 'rtl'` when it reads right to left.
 * The markup (`demo-page.html`) holds no words: each element names its key in
 * `data-t`, and `fill` puts the words in.
 *
 * Which language shows: `?lang=xx` first, then the one chosen on this page
 * before (kept in the browser's storage for this site, like the theme), then
 * the browser's own, then English. A switch appears in the head only once
 * there is more than one.
 */

export interface Copy {
  readonly lang: string
  readonly dir: 'ltr' | 'rtl'
  /** The language's name in itself, for the switch. */
  readonly name: string
  readonly title: string
  readonly description: string
  readonly rail: {
    readonly roadmap: string
    /** The toggle's label says what a press does. */
    readonly theme: { readonly toLight: string; readonly toDark: string }
    readonly language: string
    readonly free: string
    readonly source: string
    readonly privacy: string
  }
  /** The rows of the roadmap, by section id. */
  readonly rows: Readonly<Record<string, string>>
  readonly hero: { readonly name: string; readonly tagline: string; readonly story: readonly string[] }
  readonly tours: {
    readonly try: string
    readonly lead: string
    readonly receipt: Tour
    readonly ledger: Tour
    readonly development: Tour
    readonly timesheet: Tour
  }
  readonly engine: {
    readonly heading: string
    readonly body: readonly string[]
    readonly caption: string
    readonly claim: {
      readonly receipt: string
      readonly receiptHead: string
      readonly card: string
      readonly cardHead: string
      /** The four items, in the receipt's order: the figures are the demo's. */
      readonly items: readonly [string, string, string, string]
      readonly total: string
      readonly charged: string
      readonly claim: string
      readonly rule: string
      /** `{off}` is the difference. */
      readonly failed: string
      readonly summary: string
    }
  }
  readonly inbox: {
    readonly summary: string
    readonly caption: string
    readonly projects: readonly [Project, Project, Project]
    readonly inbox: string
    readonly empty: string
    readonly found: string
    readonly note: string
    readonly from: string
    readonly starts: string
    readonly states: { readonly new: string; readonly triaged: string; readonly applied: string }
    readonly became: string
    readonly decided: string
    readonly second: string
    readonly recording: string
  }
  readonly shots: {
    readonly label: string
    readonly pause: string
    readonly play: string
    readonly split: Shot
    readonly whereitwent: Shot
    readonly wealth: Shot
    readonly year: Shot
  }
  readonly words: {
    readonly mcp: Section
    readonly packs: Section
    readonly ledger: Section
    readonly development: Section
    readonly local: Section
  }
  readonly foot: {
    readonly heading: string
    /** The two doors in, under the heading: the package for an assistant, the app for money. */
    readonly ways: string
    readonly email: string
    readonly use: string
    readonly send: string
    /** `{address}` is the mail link. */
    readonly instead: string
    readonly address: string
  }
  readonly footer: {
    /** `{author}` and `{source}` are links; `source` is the word the link shows. */
    readonly line: string
    readonly source: string
  }
}

export interface Tour {
  readonly label: string
  readonly lead: string
  /** The frame's title, for a screen reader. */
  readonly title: string
}

/** A made-up project in the inbox diagram: its name, and its document's file. */
export interface Project {
  readonly name: string
  readonly file: string
}

/** A picture of one of the app's screens: what it shows, for a reader who cannot see it, and its caption. */
export interface Shot {
  readonly label: string
  readonly alt: string
  readonly caption: string
}

export interface Section {
  readonly heading: string
  readonly body: readonly string[]
}

export const LANGUAGES: readonly Copy[] = [en]

const STORAGE_KEY = 'emerald-page-lang'

export function pickLanguage(): Copy {
  const first = LANGUAGES[0] ?? en
  if (LANGUAGES.length === 1) return first
  const asked = new URLSearchParams(location.search).get('lang')
  const byAsked = LANGUAGES.find((copy) => copy.lang === asked)
  if (byAsked) return byAsked
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    stored = null
  }
  const byStored = LANGUAGES.find((copy) => copy.lang === stored)
  if (byStored) return byStored
  const wanted = (navigator.languages ?? [navigator.language]).map((tag) => tag.toLowerCase().split('-')[0])
  for (const tag of wanted) {
    const found = LANGUAGES.find((copy) => copy.lang === tag)
    if (found) return found
  }
  return first
}

export function rememberLanguage(lang: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Nowhere to keep it: the choice lasts for this page.
  }
}

/** A key like `hero.tagline` or `tours.receipt.lead`, read off the copy. */
export function lookup(copy: Copy, key: string): unknown {
  let at: unknown = copy
  for (const part of key.split('.')) {
    if (typeof at !== 'object' || at === null) return undefined
    at = (at as Record<string, unknown>)[part]
  }
  return at
}

/**
 * Put the words in. A string fills the element's text; a list of strings
 * becomes one `<p>` per item; a string holding `{slots}` keeps the element's
 * own `data-slot` children and sets them in at their places, so a link in a
 * sentence is markup here and a word in the copy.
 */
export function fill(root: ParentNode, copy: Copy): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-t]')) {
    const key = element.dataset.t ?? ''
    const value = lookup(copy, key)
    if (typeof value === 'string') {
      if (value.includes('{')) fillTemplate(element, value)
      else element.textContent = value
    } else if (Array.isArray(value)) {
      // An array is paragraphs, or, where the markup says `data-list`, short
      // points in a list: what a person gains, one line each
      // (2026-10-15: nobody reads the paragraphs).
      const asList = element.hasAttribute('data-list')
      const items = value.map((text, index) => {
        const item = document.createElement(asList ? 'li' : 'p')
        item.textContent = String(text)
        // The point's place in its list, for the stagger when the row is reached.
        if (asList) item.style.setProperty('--i', String(index))
        return item
      })
      if (asList) {
        const list = document.createElement('ul')
        list.className = 'points'
        list.append(...items)
        element.replaceChildren(list)
      } else {
        element.replaceChildren(...items)
      }
    } else {
      console.error(`The copy has no "${key}".`)
    }
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-t-attr]')) {
    // `data-t-attr="title:tours.receipt.title"`: an attribute's words.
    for (const pair of (element.dataset.tAttr ?? '').split(';')) {
      const [attr, key] = pair.split(':').map((part) => part.trim())
      if (!attr || !key) continue
      const value = lookup(copy, key)
      if (typeof value === 'string') element.setAttribute(attr, value)
    }
  }
}

function fillTemplate(element: HTMLElement, template: string): void {
  const slots = new Map<string, Element>()
  for (const child of element.querySelectorAll<HTMLElement>('[data-slot]')) slots.set(child.dataset.slot ?? '', child)
  const nodes: Node[] = []
  for (const piece of template.split(/(\{\w+\})/)) {
    const slot = /^\{(\w+)\}$/.exec(piece)?.[1]
    if (slot === undefined) {
      if (piece !== '') nodes.push(document.createTextNode(piece))
    } else {
      const found = slots.get(slot)
      if (found) nodes.push(found)
      else nodes.push(document.createTextNode(piece))
    }
  }
  element.replaceChildren(...nodes)
}
