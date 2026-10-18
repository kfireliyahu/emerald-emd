import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PACKS } from '@/data/packs/packs.ts'

/**
 * **A place is a named anchor, and this keeps it honest** (M28 U9, S4).
 *
 * Each screen marks the places a guide points at — `data-guide="plan.split"`,
 * or a section's `guide` prop — and every step a pack declares must name one
 * some screen has. Without it, the first redesign of a screen breaks the guide
 * silently: the dialog would sit in the middle of the page pointing at nothing.
 */
const UI = fileURLToPath(new URL('..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : []
  })
}

function marked(): ReadonlySet<string> {
  const places = new Set<string>()
  for (const file of sources(UI)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\b(?:data-guide|guide)="([^"]+)"/g)) {
      for (const place of (match[1] ?? '').split(/\s+/)) if (place !== '') places.add(place)
    }
  }
  return places
}

describe('every place a guide names is one a screen has', () => {
  it('finds each step’s place, and the title the offer stands beside', () => {
    const places = marked()
    expect(places.has('home.title')).toBe(true)
    for (const pack of PACKS) {
      for (const step of pack.guide?.steps ?? []) {
        expect(places.has(step.place), `${pack.id}: ${step.id} points at ${step.place}`).toBe(true)
      }
    }
  })

  it('gives the ledger the six steps the mockup approved, and Categories before By merchant (F13)', () => {
    const ledger = PACKS.find((pack) => pack.id === 'ledger')
    expect(ledger?.guide?.steps.map((step) => step.id)).toEqual(['read', 'categories', 'merchant', 'fixed', 'split', 'opening', 'cushion'])
  })
})
