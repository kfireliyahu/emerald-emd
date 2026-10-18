/**
 * What a person who downloaded an installer is owed by the app itself (M43 U7, D-452): which
 * version this is, that it is free software with no warranty, where its source is, the licence
 * and the notices of everything it bundles — and that it computes rather than advises.
 *
 * **The source address is read from `package.json`'s `repository` and from nowhere else**, so a
 * different public slug is a one-line change there. It is also the one address outside the app
 * the shell will ever hand to the system browser, and only from a menu click (`openSource` in
 * `main.ts`): D-124 is about the *page* reaching the network, and a person choosing to open the
 * project's page in their own browser is not that — but it stays one fixed address, not a URL the
 * renderer can name.
 *
 * Pure and string-in, string-out, so what the About says is a test.
 */

import { author, repository } from '../package.json'

/** The two texts the About opens inside the app, served from `dist/` over `app://`. */
export const BUNDLED_TEXTS = {
  license: { file: 'LICENSE.txt', title: 'Emerald — License (GNU AGPL-3.0)' },
  notices: { file: 'THIRD_PARTY_NOTICES.txt', title: 'Emerald — Third-party notices' },
} as const

export type BundledText = keyof typeof BUNDLED_TEXTS

/**
 * `git+https://github.com/owner/name.git` → `https://github.com/owner/name`. Anything that is
 * not an https address is refused rather than guessed at: this string reaches `openExternal`.
 */
export function sourceUrlFrom(field: string | { url: string }): string {
  const raw = typeof field === 'string' ? field : field.url
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`package.json's repository is not an address: ${raw}`)
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new Error(`package.json's repository is not a plain https address: ${raw}`)
  }
  return parsed.href.replace(/\/+$/, '')
}

/** The repository, from `package.json`. The only address `shell.openExternal` is given. */
export const SOURCE_URL = sourceUrlFrom(repository)

/** The source of exactly this build: the tag the release workflow builds from. */
export function taggedSourceUrl(version: string, source: string = SOURCE_URL): string {
  return `${source}/tree/v${version}`
}

/** The year of first publication, as `electron-builder.yml`'s `copyright` says it. */
const COPYRIGHT_YEAR = 2026

/** `Name <address>` → `Name`. */
function authorName(field: string): string {
  return field.replace(/\s*<[^>]*>\s*$/, '').trim()
}

/** The plain line, in the README and here: Emerald computes, it does not advise (D-308). */
export const NOT_ADVICE =
  'Emerald computes; it does not advise. Check every figure it read from a paycheck, a pension ' +
  'report or a statement against the document it came from.'

const LICENSE_LINE = 'Free software under the GNU AGPL-3.0-only, with no warranty.'

/** The body of the About, the same on every platform. */
export function aboutCredits(version: string, source: string = SOURCE_URL): string {
  return [
    LICENSE_LINE,
    '',
    NOT_ADVICE,
    '',
    `Source: ${source}`,
    `This version: ${taggedSourceUrl(version, source)}`,
    '',
    'The license and the third-party notices are in the Help menu.',
  ].join('\n')
}

/**
 * What `app.setAboutPanelOptions` takes, which macOS shows from the app menu's About. Help → About
 * Emerald is the page's own since M45 F3 (D-457), and `main.ts` hands it these same fields, so the
 * two say one thing. `website` and `authors` are Linux's; the others ignore them.
 */
export function aboutPanelOptions(version: string, source: string = SOURCE_URL) {
  const name = authorName(author)
  return {
    applicationName: 'Emerald',
    applicationVersion: version,
    copyright: `Copyright © ${COPYRIGHT_YEAR} ${name}`,
    credits: aboutCredits(version, source),
    authors: [name],
    website: source,
  }
}
