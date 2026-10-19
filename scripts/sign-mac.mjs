// electron-builder's `afterPack` hook (M42 F4): an ad-hoc signature on the Mac app, before the
// disk image is made.
//
// `mac.identity: null` makes electron-builder skip signing altogether, and packing renames
// Electron's app and rewrites its Info.plist, which breaks the signature Electron shipped with. A
// downloaded app whose signature does not match its bundle is "damaged" to macOS, and that has no
// Open Anyway. Signed ad hoc — `-`, no certificate, no account, no notarization (D-124 stands) —
// the same download is an app Apple could not verify, which System Settings lets a person open.
//
// electron-builder 26 has no setting for this: `identity: "-"` is looked up in the keychain as a
// name. So it is a hook, and it fails the build when codesign does.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** The codesign call for one packed app: ad hoc, the helpers and frameworks inside it too. */
export function signArgs(app) {
  return ['--force', '--deep', '--sign', '-', app]
}

export default function afterPack(context, run = execFileSync) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  run('codesign', signArgs(app), { stdio: 'inherit' })
}
