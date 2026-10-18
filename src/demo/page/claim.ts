import { EASING, MARK_MS, motionOn } from '@/ui/motion/motion.ts'
import type { Copy } from './copy.ts'

/**
 * **The claim, playing itself** (M33 F8): what the AI half's recording will
 * show, drawn until the recording exists — the receipt's four lines arriving
 * one by one as rows arrive in the app (`fc-row-enter`), the total and the
 * card charge after them, and the claim failing with the verdict's own mark
 * (`useMark`'s negative tint, once). The figures are the custom tour's
 * (`fixtures/synthetic/demo/receipt.json`): Corner Market, 84.00 printed,
 * 96.00 charged; the words are the copy's. It plays each time the card comes
 * into view and is cleared when it leaves; under reduced motion it is drawn
 * finished at once.
 */

const PRICES: readonly string[] = ['12.00', '8.00', '24.00', '40.00']
const TOTAL = '84.00'
const CHARGE = '96.00'
const OFF = '12.00'
const STEP_MS = 420

/** `useMark`'s tint for a failure, stated here so the page does not import React for one string. */
const NEGATIVE_TINT = 'color-mix(in srgb, var(--color-negative) 24%, transparent)'

export function mountClaim(card: HTMLElement, words: Copy['engine']['claim']): void {
  let timers: number[] = []
  const clear = (): void => {
    for (const timer of timers) window.clearTimeout(timer)
    timers = []
    card.replaceChildren()
  }
  const at = (ms: number, step: () => void): void => {
    timers.push(window.setTimeout(step, ms))
  }

  const play = (): void => {
    clear()
    const moving = motionOn()
    const receipt = block(card, words.receipt, words.receiptHead)
    const charge = block(card, words.card, words.cardHead)
    const claim = document.createElement('div')
    claim.className = 'claim-verdict'
    card.append(claim)

    let t = moving ? STEP_MS : 0
    words.items.forEach((item, index) => {
      at(t, () => row(receipt, item, PRICES[index] ?? '', moving))
      t += moving ? STEP_MS : 0
    })
    at(t, () => row(receipt, words.total, TOTAL, moving, true))
    t += moving ? STEP_MS * 1.5 : 0
    at(t, () => row(charge, words.charged, CHARGE, moving, true))
    t += moving ? STEP_MS * 1.5 : 0
    at(t, () => {
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = words.claim
      const rule = document.createElement('span')
      rule.className = 'claim-text'
      rule.textContent = words.rule
      const word = document.createElement('span')
      word.className = 'claim-word'
      word.dataset.verdict = 'failed'
      word.textContent = words.failed.replace('{off}', OFF)
      claim.replaceChildren(label, rule, word)
      if (moving) {
        word.animate(
          [
            { backgroundColor: NEGATIVE_TINT, boxShadow: `0 0 0 3px ${NEGATIVE_TINT}` },
            { backgroundColor: 'transparent', boxShadow: '0 0 0 3px transparent' },
          ],
          { duration: MARK_MS, easing: EASING, iterations: 1 },
        )
      }
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
  watch.observe(card)
}

function block(card: HTMLElement, label: string, head: string): HTMLElement {
  const box = document.createElement('div')
  box.className = 'claim-block'
  const tag = document.createElement('span')
  tag.className = 'label'
  tag.textContent = label
  const title = document.createElement('span')
  title.className = 'claim-head'
  title.textContent = head
  box.append(tag, title)
  card.append(box)
  return box
}

function row(box: HTMLElement, name: string, figure: string, moving: boolean, strong = false): void {
  const line = document.createElement('div')
  line.className = `claim-row${strong ? ' strong' : ''}${moving ? ' fc-row-enter' : ''}`
  const left = document.createElement('span')
  left.textContent = name
  const right = document.createElement('span')
  right.className = 'claim-figure'
  right.textContent = figure
  line.append(left, right)
  box.append(line)
}
