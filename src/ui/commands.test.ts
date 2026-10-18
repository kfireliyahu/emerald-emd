import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildCommands, filterCommands, type Command } from './commands.ts'

/**
 * The palette's ranking, which is the only part of it with an opinion (D-130).
 *
 * `buildCommands` reads the document store and is exercised by driving the app;
 * what a test can hold still is the match: a subsequence rather than a
 * substring, because "wsav" finding "Wealth · Savings" is the whole reason to
 * type into a box instead of reading a menu.
 */

function command(label: string, keywords?: string): Command {
  return {
    id: label,
    label,
    group: 'Go to',
    ...(keywords === undefined ? {} : { keywords }),
    run: () => undefined,
  }
}

const COMMANDS: readonly Command[] = [
  command('Home'),
  command('Transactions'),
  command('Wealth · Savings', 'Savings'),
  command('Wealth · Deposit check', 'Deposit check'),
  command('Save'),
  command('Save a copy…'),
  command('Import a statement…', 'card bank xlsx csv upload open file'),
]

const labels = (query: string): string[] =>
  filterCommands(COMMANDS, query).map((found) => found.label)

describe('the command palette filter', () => {
  it('matches a scattered subsequence, not just a substring', () => {
    expect(labels('wsav')).toContain('Wealth · Savings')
    expect(labels('wsav')).not.toContain('Save')
  })

  it('puts the tightest, earliest match first', () => {
    // "Save" is the label itself; "Wealth · Savings" only contains it later.
    expect(labels('save')[0]).toBe('Save')
    expect(labels('trans')[0]).toBe('Transactions')
  })

  it('finds a command by a word that is never shown', () => {
    expect(labels('csv')).toEqual(['Import a statement…'])
  })

  it('returns everything, in declared order, for an empty query', () => {
    expect(labels('')).toEqual(COMMANDS.map((found) => found.label))
    expect(labels('   ')).toEqual(COMMANDS.map((found) => found.label))
  })

  it('returns nothing rather than everything when nothing matches', () => {
    expect(labels('zzz')).toEqual([])
  })

  it('ignores case in both directions', () => {
    expect(labels('HOME')).toContain('Home')
    expect(labels('home')).toContain('Home')
  })

  /**
   * The weighting, which was wrong the first way round: with the start index
   * leading, "trend" put "Toggle the sidebar" above "Insights · Trends",
   * because t-r-e-n-d is in it if you walk the whole string and it starts at
   * character zero. A typed word means a word.
   */
  it('prefers a contiguous match to one that starts earlier', () => {
    const commands = [command('Toggle the sidebar', 'collapse expand nav'), command('Home · Trends')]
    expect(filterCommands(commands, 'trend').map((found) => found.label)[0]).toBe('Home · Trends')
  })

  /**
   * With entries under them (M37 U2c), only a match that crosses at most one
   * gap is kept: Save is still first for "save", and a command found by walking
   * its whole label is no longer noise above the entries.
   */
  it('keeps only the tight matches when entries follow', () => {
    const tight = (query: string): string[] => filterCommands(COMMANDS, query, true).map((found) => found.label)
    expect(tight('save')[0]).toBe('Save')
    expect(tight('wsav')).toEqual(['Wealth · Savings'])
    // i…a…t: two gaps into "Import a statement…" — found, but not tight.
    expect(labels('iat')).toContain('Import a statement…')
    expect(tight('iat')).not.toContain('Import a statement…')
  })
})

/**
 * **The demo has no Document group and no recents** (M33 U1, D-413): a visitor
 * has no file to make, open or save, so the palette offers none of it — and the
 * app's own build is unchanged, which is the other half of the same test.
 */
describe('the palette in the demo', () => {
  const context = {
    go: () => undefined,
    importStatement: () => undefined,
    recents: [{ path: '/somewhere/else.emd', name: 'else.emd' }],
  }
  const ids = (): string[] => buildCommands(context).map((each) => each.id)

  afterEach(() => vi.unstubAllEnvs())

  it('offers New, Open and the recents in the app', () => {
    expect(ids()).toEqual(expect.arrayContaining(['doc:new', 'doc:open', 'recent:/somewhere/else.emd']))
  })

  it('offers none of them in the demo', () => {
    vi.stubEnv('MODE', 'demo')
    expect(ids().filter((id) => id.startsWith('doc:') || id.startsWith('recent:'))).toEqual([])
    expect(ids()).toContain('do:sidebar')
  })
})
