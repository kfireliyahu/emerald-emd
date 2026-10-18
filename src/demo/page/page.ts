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
 * **The release the installers link to** (M42 F2). Its files carry the version
 * (`electron-builder.yml`'s `artifactName`), so `releases/latest/download/` cannot
 * name them: the page links this release's files, and moving it is one line here
 * once a newer release is out. `rail.test.ts` fails when the names below stop
 * being the ones the build writes.
 */
export const RELEASE = '0.1.0'

/** Every release, newest first: where the caption under the installers points. */
export const RELEASES_URL = `${SOURCE_URL}/releases`

/** The README's own install section, which says how past each platform's warning. */
export const README_INSTALL_URL = `${SOURCE_URL}#installing-it`

/** The installers and the checksums beside them, by the name each is linked under. */
export function installers(version: string): Record<'windows' | 'arm64' | 'x64' | 'sums', string> {
  return {
    windows: `Emerald-Setup-${version}.exe`,
    arm64: `Emerald-${version}-arm64.dmg`,
    x64: `Emerald-${version}-x64.dmg`,
    sums: 'SHA256SUMS',
  }
}
