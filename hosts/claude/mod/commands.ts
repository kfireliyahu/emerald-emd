/**
 * **`/claim <ref>` and `/land [ref]`** (M56 U3): the two calls that start and
 * end a unit, handed to the model with what the module can know — the
 * project's document, the branch, the commit, whether this is a worktree — so
 * it makes the call rather than working the arguments out again.
 *
 * **The module writes nothing** (U1's read-only line): a command answers the
 * person in a line, leaves the call for the model in its `context`, which the
 * person never sees, and asks for a turn. Every write still goes through the
 * tool, dry-run first, under the person's own permission rules.
 *
 * - `/claim M56 U3` hands over `claim_units` for that unit, taken on this branch.
 * - `/land` hands over the landing of the unit this branch claimed (or the one
 *   named): `land_units` in the main checkout, and from a linked worktree the
 *   proposal a driver lands, one `inbox` row in the main checkout's document.
 */
import type { EngineInterface, On } from 'claude-code'

import { branchOf, documentAt, git } from './git.ts'
import { basename, normalize } from './project.ts'

/** What /claim remembers for /land, per document and branch, in `$.store`. */
const claimedKey = (document: string, branch: string) => `claimed:${document}:${branch}`

const NO_DOCUMENT = 'This folder has no Emerald document: name one in .claude/emerald.json, or keep one .emd here.'

/** A JSON value as the model should pass it. */
const json = (value: unknown) => JSON.stringify(value)

/** The context /claim leaves the model: one call, dry-run first. */
export function claimContext(document: string, ref: string, branch: string | undefined): string {
  const args = {
    path: document,
    units: [ref],
    taken_by: branch === undefined ? 'a Claude Code session' : `a Claude Code session on ${branch}`,
    ...(branch === undefined ? {} : { branch }),
  }
  return (
    `The person ran /claim ${ref}. Call \`claim_units\` with ${json(args)}. It dry-runs: when it shows ${ref} ` +
    'going from planned to in_progress, call it again with `commit: true`. If it is refused, say why in a line and stop; ' +
    'do not claim another unit instead.'
  )
}

/** The context /land leaves the model: the landing, or from a worktree its proposal. */
export function landContext(options: {
  readonly document: string
  readonly ref: string | undefined
  readonly branch: string | undefined
  readonly commit: string | undefined
  readonly isClean: boolean
  readonly worktreeCopy: string | undefined
  readonly today: string
}): string {
  const { document, ref, branch, commit, isClean, worktreeCopy, today } = options
  const unit = ref ?? 'the unit this session claimed'
  const lines = [`The person ran /land. Land ${unit}.`]
  if (!isClean || commit === undefined) {
    lines.push(
      'The working tree has uncommitted changes: run the closing pass and commit the unit\'s work first (its own files, never the document\'s copy), then land with that commit.',
    )
  }
  const landing = {
    unit: ref ?? '<the unit>',
    commit: isClean && commit !== undefined ? commit : '<the commit that carries the work>',
    ...(branch === undefined ? {} : { branch }),
    files: '<the files it touched, one per line>',
    decisions: '<its decision rows, or []>',
    review_entries: '<its review entries, or []>',
    report: '<the closing report>',
  }
  if (worktreeCopy !== undefined) {
    lines.push(
      'This is a linked worktree, so it lands nothing itself: it proposes the landing for the driver, as one row in the ' +
        `main checkout's document. Call \`record_format_rows\` on ${json(document)}, format \`inbox\`, one row: ` +
        json({ subject: `Landing ${unit}`, from: worktreeCopy, sent_on: today, state: 'new', ...(ref === undefined ? {} : { refs: ref }) }) +
        ', its `body` one ```json block holding ONE object (not an array): ' +
        json(landing) +
        '. It dry-runs; then the same call with `commit: true`. Say the row\'s id.',
    )
  } else {
    lines.push(
      `Call \`land_units\` with ${json({ path: document, units: [landing] })}, the placeholders filled. It dry-runs; ` +
        'read it, then the same call with `commit: true`. If it is refused, say why in a line and stop.',
    )
  }
  return lines.join(' ')
}

/** The project's document from the session's folder, or what to say instead. */
async function projectOf($: EngineInterface): Promise<{ folder: string; document: string; worktreeCopy: string | undefined } | { text: string }> {
  const folder = normalize(await $.session.cwd())
  const project = await documentAt($, folder)
  if (project.kind === 'problem') return { text: project.message }
  if (project.kind === 'none') return { text: NO_DOCUMENT }
  return { folder, document: project.path, worktreeCopy: project.worktreeCopy }
}

/**
 * Asks for a turn on what the command left the model: a timer's dispatch of its
 * own, as the pane's reads are, so the command answers first and the turn
 * starts once the session is idle, never awaited by the command itself.
 */
function handOver($: EngineInterface, text: string): void {
  $.clock.after(0, () => {
    void $.prompt.submit({ text }).catch(() => undefined)
  })
}

export function registerCommands(on: On): void {
  // The engine refuses a second matcher-less `session.start` hook in one module
  // (the pane holds the first), so this one names a matcher that takes every
  // session: the commands are the person's at a prompt and an SDK host's alike.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    await $.command.register({
      name: 'claim',
      description: 'Claim a planned unit of this project’s document, on this branch',
      argumentHint: '<unit ref>',
    })
    await $.command.register({
      name: 'land',
      description: 'Land the unit this branch built, or from a worktree propose its landing',
      argumentHint: '[unit ref]',
    })
    return next(e)
  })

  on('command.run', { command: 'claim' }, async ($, e) => {
    const ref = e.args.trim()
    if (ref === '') return { text: '`/claim <unit ref>` claims a planned unit of this project’s document, on this branch: `/claim M2 U3`.' }
    const project = await projectOf($)
    if ('text' in project) return { text: project.text }
    const branch = await branchOf($, project.folder)
    if (branch !== undefined) await $.store.set(claimedKey(project.document, branch), ref)
    handOver($, `Claim ${ref}.`)
    return {
      text: `Claiming ${ref} in ${basename(project.document)}${branch === undefined ? '' : ` on ${branch}`}.`,
      context: [claimContext(project.document, ref, branch)],
    }
  })

  on('command.run', { command: 'land' }, async ($, e) => {
    const project = await projectOf($)
    if ('text' in project) return { text: project.text }
    const branch = await branchOf($, project.folder)
    const named = e.args.trim()
    const remembered = branch === undefined ? undefined : await $.store.get(claimedKey(project.document, branch))
    const ref = named !== '' ? named : typeof remembered === 'string' ? remembered : undefined
    const commit = await git($, project.folder, ['rev-parse', '--short', 'HEAD'])
    // What is uncommitted besides the document's own copy, which a worktree never commits.
    const changed = (await git($, project.folder, ['status', '--porcelain']))
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !/\.emd"?$/i.test(line.trim()))
    const today = new Date().toISOString().slice(0, 10)
    const context = landContext({
      document: project.document,
      ref,
      branch,
      commit: commit === '' ? undefined : commit,
      isClean: changed.length === 0,
      worktreeCopy: project.worktreeCopy,
      today,
    })
    handOver($, ref === undefined ? 'Land the unit.' : `Land ${ref}.`)
    const what = ref ?? 'the unit'
    return {
      text: project.worktreeCopy === undefined ? `Landing ${what}.` : `Proposing the landing of ${what} from this worktree.`,
      context: [context],
    }
  })
}
