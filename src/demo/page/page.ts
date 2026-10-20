/**
 * **What Emerald's page may reach for, and does not yet** (M33 U8, D-459).
 *
 * The page may make the two requests the app never makes — a form post and a
 * visit count — and D-124 is the app's rule, unchanged: the shell blocks every
 * request that is not its own, and this page is not the shell. Each of the two
 * is added only once PRIVACY.md says who processes it, how long it is kept and
 * how to have it deleted (M43 U7, D-452), and only once the maintainer has picked
 * the service. Until then both are off, which these two constants say: an
 * empty `FORM_ACTION` draws no form and offers the contact address instead, because a
 * form that posts nowhere is a lie; an empty `COUNT_SCRIPT` loads nothing.
 */

/** The form service's endpoint; empty until the maintainer picks one (M33 U9). */
export const FORM_ACTION = ''

/** The privacy-respecting counter's script; empty until the maintainer picks one (M33 U9). */
export const COUNT_SCRIPT = ''

/**
 * **The recording for the development pack's section** (M33 F11): a
 * file served beside the page, named here once it exists (`development.mp4`,
 * say, put in `fixtures/synthetic/demo/` and copied by the demo build). Empty
 * draws nothing: the page names no file it does not have. It is recorded on the
 * demo's made-up project, never on `docs/memory.emd` (docs/page-recording-development.md).
 */
export const DEVELOPMENT_RECORDING: string = 'development.mp4'

/** Where a note goes while there is no form: the address LICENSING.md and SECURITY.md give. */
export const CONTACT = 'me@kfireliyahu.com'

/**
 * The repository, the one address `package.json` names (D-452); `rail.test.ts`
 * fails when the two differ.
 */
export const SOURCE_URL = 'https://github.com/kfireliyahu/emerald-emd'

/** The Claude plugin's own page in the repository: what it runs (M42 U4). */
export const PLUGIN_URL = `${SOURCE_URL}/blob/main/hosts/claude/README.md`

/** The MCP server's package (M42 U2). */
export const NPM_URL = 'https://www.npmjs.com/package/emerald-mcp'

/**
 * **The installers have no version in their names** (M42 U9, D-503), so the page
 * links `releases/latest/download/<name>`, which GitHub answers with the newest
 * release's file — the page never names a version and never goes stale.
 * `rail.test.ts` fails when the names below stop being the ones the build writes.
 */
export const LATEST_DOWNLOAD = `${SOURCE_URL}/releases/latest/download/`

/** The newest release's own page: every file, and the notes. */
export const LATEST_RELEASE = `${SOURCE_URL}/releases/latest`

/**
 * **Until a release carries those names** (v0.1.0 is `Emerald-Setup-0.1.0.exe`), a
 * `releases/latest/download/` link would be a 404, so the installers link the newest
 * release's page instead — one click more, never broken, and never stale, because it
 * is whatever is newest. Set it to `true` once a release made by M42 U9's build is
 * out; the review entry for that release says so.
 */
export const NAMED_INSTALLERS_RELEASED = true

/** Every release, newest first: where the caption under the installers points. */
export const RELEASES_URL = `${SOURCE_URL}/releases`

/** The README's own install section, which says how past each platform's warning. */
export const README_INSTALL_URL = `${SOURCE_URL}#installing-it`

/**
 * The installers and the checksums beside them, by the name each is linked under, and
 * the Claude desktop extension the same release carries (M42 F9, F13), which the page
 * offers first to anyone with the Claude app.
 */
export const INSTALLERS: Readonly<Record<'windows' | 'arm64' | 'x64' | 'sums' | 'extension', string>> = {
  windows: 'Emerald-Setup.exe',
  arm64: 'Emerald-arm64.dmg',
  x64: 'Emerald-x64.dmg',
  sums: 'SHA256SUMS',
  extension: 'emerald.mcpb',
}

/** Where an installer card links: the newest release's file, or its page until the names are out. */
export function installerLink(file: string, released: boolean = NAMED_INSTALLERS_RELEASED): string {
  return released ? `${LATEST_DOWNLOAD}${file}` : LATEST_RELEASE
}
