/**
 * **What the guards and the commands ask of the machine** (M56 U3): the three
 * file calls the folder rule reads with, and `git`, run through
 * `$.process.run` since a module has no Node. Read-only, every one.
 */
import type { EngineInterface } from 'claude-code'

import { projectDocument, type ProjectDocument, type ProjectFiles } from './project.ts'

/** The three file calls the folder rule reads with, each spelled at its call as a module must. */
export function filesOf($: EngineInterface): ProjectFiles {
  return {
    read: (path) => $.fs.read(path),
    list: (path) => $.fs.list(path),
    stat: (path) => $.fs.stat(path),
  }
}

/** The document the project at `folder` means (`project.ts`). */
export function documentAt($: EngineInterface, folder: string): Promise<ProjectDocument> {
  return projectDocument(filesOf($), folder)
}

/**
 * `git <args>` in `folder`: what it printed, trimmed, or '' when it exited
 * other than 0. A git that cannot start rejects, and a guard that awaits it
 * fails, so refuses (its `.catch`).
 */
export async function git($: EngineInterface, folder: string, args: readonly string[]): Promise<string> {
  const ran = await $.process.run(['git', ...args], { cwd: folder })
  return ran.exitCode === 0 ? ran.stdout.trim() : ''
}

/** The branch checked out in `folder`, or undefined on a detached head. */
export async function branchOf($: EngineInterface, folder: string): Promise<string | undefined> {
  const branch = await git($, folder, ['branch', '--show-current'])
  return branch === '' ? undefined : branch
}
