import { EASING, MARK_MS, motionOn } from '@/ui/motion/motion.ts'
import type { Copy } from './copy.ts'

/**
 * **The inbox, playing itself** (M33 F11): three made-up projects, each its own
 * document, and a note crossing between them the way the development pack's
 * `inbox` carries one. A session in the first finds something the second must
 * know and writes it into the second's document; the second's next session
 * starts with it (M47 U1), triages it, and applies it as a unit of its own. Then
 * the third writes to the first, so it reads as a web and not a pipe.
 *
 * A note travels as rows arrive in the app: it is put where it lands and slid
 * there from where it was written (one FLIP, so it is right at any width and
 * when the cards stack on a phone). States wear the app's tones — `new` is
 * waiting, `triaged` live, `applied` done — and a change is marked once, as
 * `useMark` marks one. It plays each time the diagram comes into view and is
 * cleared when it leaves; under reduced motion it is drawn finished at once.
 */

const STEP_MS = 700

/** `useMark`'s tint for a change, stated here so the page does not import React for one string. */
const ACCENT_TINT = 'color-mix(in srgb, var(--color-accent) 24%, transparent)'

type State = 'new' | 'triaged' | 'applied'

const TONE: Readonly<Record<State, string>> = { new: 'waiting', triaged: 'live', applied: 'done' }

export function mountInbox(stage: HTMLElement, words: Copy['inbox']): void {
  let timers: number[] = []
  const clear = (): void => {
    for (const timer of timers) window.clearTimeout(timer)
    timers = []
    stage.replaceChildren()
  }
  const at = (ms: number, step: () => void): void => {
    timers.push(window.setTimeout(step, ms))
  }

  const play = (): void => {
    clear()
    const moving = motionOn()
    const [app, site, notes] = words.projects.map((project) => documentCard(stage, project, words))
    if (app === undefined || site === undefined || notes === undefined) return

    let t = moving ? STEP_MS : 0
    const next = (step: () => void, wait = 1): void => {
      at(t, step)
      t += moving ? STEP_MS * wait : 0
    }

    // The first project's session finds what the second must know, and writes it there.
    let found: HTMLElement | undefined
    next(() => {
      found = sessionLine(app, words.found, moving)
    })
    let note: Note | undefined
    next(() => {
      note = arrive(site, words.note, words.from.replace('{project}', app.name), words.states.new, found, moving)
    }, 1.5)
    // The second's next session starts with it, triages it, and applies it as a unit.
    next(() => {
      sessionLine(site, words.starts, moving)
    })
    next(() => {
      if (note) mark(note, 'triaged', words.states.triaged, moving)
    })
    next(() => {
      if (note) mark(note, 'applied', words.states.applied, moving)
    })
    next(() => {
      if (note) became(note, words.became, moving)
    }, 1.5)
    // And the third writes to the first: every project's document has an inbox.
    let thought: HTMLElement | undefined
    next(() => {
      thought = sessionLine(notes, words.decided, moving)
    })
    next(() => {
      arrive(app, words.second, words.from.replace('{project}', notes.name), words.states.new, thought, moving)
    })
  }

  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) play()
        else clear()
      }
    },
    { threshold: 0.4 },
  )
  watch.observe(stage)
}

interface Card {
  readonly name: string
  readonly session: HTMLElement
  readonly rows: HTMLElement
  readonly empty: HTMLElement
}

interface Note {
  readonly row: HTMLElement
  readonly dot: HTMLElement
  readonly chip: HTMLElement
}

function documentCard(stage: HTMLElement, project: Copy['inbox']['projects'][number], words: Copy['inbox']): Card {
  const card = document.createElement('div')
  card.className = 'inbox-doc'
  const head = document.createElement('div')
  head.className = 'inbox-head'
  const name = document.createElement('span')
  name.className = 'inbox-name'
  name.textContent = project.name
  const file = document.createElement('span')
  file.className = 'inbox-file'
  file.textContent = project.file
  head.append(name, file)
  const session = document.createElement('div')
  session.className = 'inbox-session'
  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = words.inbox
  const rows = document.createElement('div')
  rows.className = 'inbox-rows'
  const empty = document.createElement('span')
  empty.className = 'inbox-empty'
  empty.textContent = words.empty
  rows.append(empty)
  card.append(head, session, label, rows)
  stage.append(card)
  return { name: project.name, session, rows, empty }
}

/** What a session in this project is doing, said once above its inbox. */
function sessionLine(card: Card, text: string, moving: boolean): HTMLElement {
  const line = document.createElement('div')
  line.className = `inbox-line${moving ? ' fc-row-enter' : ''}`
  line.textContent = text
  card.session.replaceChildren(line)
  return line
}

/** A note put into this project's inbox as `new`, slid there from where it was written. */
function arrive(
  card: Card,
  subject: string,
  from: string,
  state: string,
  origin: HTMLElement | undefined,
  moving: boolean,
): Note {
  const row = document.createElement('div')
  row.className = 'inbox-row'
  const dot = document.createElement('span')
  dot.className = 'fc-dot'
  dot.dataset.tone = TONE.new
  const body = document.createElement('div')
  body.className = 'inbox-body'
  const title = document.createElement('span')
  title.className = 'inbox-subject'
  title.textContent = subject
  const by = document.createElement('span')
  by.className = 'inbox-from'
  by.textContent = from
  body.append(title, by)
  const chip = document.createElement('span')
  chip.className = 'fc-state'
  chip.dataset.tone = TONE.new
  chip.textContent = state
  row.append(dot, body, chip)
  card.empty.remove()
  card.rows.append(row)

  if (moving && origin !== undefined) {
    const from = origin.getBoundingClientRect()
    const to = row.getBoundingClientRect()
    row.animate(
      [
        { transform: `translate(${String(from.left - to.left)}px, ${String(from.top - to.top)}px)`, opacity: 0.35 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: STEP_MS * 1.2, easing: EASING },
    )
  }
  return { row, dot, chip }
}

function mark(note: Note, state: State, text: string, moving: boolean): void {
  note.dot.dataset.tone = TONE[state]
  note.chip.dataset.tone = TONE[state]
  note.chip.textContent = text
  if (moving) {
    note.chip.animate(
      [
        { backgroundColor: ACCENT_TINT, boxShadow: `0 0 0 3px ${ACCENT_TINT}` },
        { boxShadow: '0 0 0 3px transparent' },
      ],
      { duration: MARK_MS, easing: EASING, iterations: 1 },
    )
  }
}

/** What the note became in the project that applied it. */
function became(note: Note, text: string, moving: boolean): void {
  const line = document.createElement('span')
  line.className = `inbox-became${moving ? ' fc-row-enter' : ''}`
  line.textContent = text
  note.row.querySelector('.inbox-body')?.append(line)
}
