#!/usr/bin/env node
/**
 * The history rewrite, as a script that has already worked (M43 U8).
 *
 * Before the repository goes public its whole history is rewritten once, on a
 * fresh clone: every author, committer and tagger becomes the one identity
 * below, and every denylist term in every file and every message becomes the
 * stand-in the denylist gives it. The rewrite is the author's own act (D-430);
 * this makes it a command he runs and reads, and `rewrite-history.md` beside it
 * is the runbook.
 *
 * It holds nothing it is guarding. The old identities are read from the clone's
 * own history and the terms from the denylist on this machine (the file
 * `src/privacy.test.ts` reads, in `git filter-repo --replace-text` form); the
 * mailmap and the expression files are written to a temporary directory
 * outside both repositories and deleted before it exits. Everything it prints
 * is a count, a hash, a path of the tree, or the new identity. Output from git,
 * filter-repo and the tests passes through a filter that withholds any line
 * holding a term or an old address.
 *
 *   node scripts/rewrite-history.mjs <fresh-clone>          # dry run: survey, change nothing
 *   node scripts/rewrite-history.mjs <fresh-clone> --run    # rewrite, then prove it
 *
 * Options:
 *   --run                 rewrite (the default is the dry run)
 *   --no-test             skip `npm ci`, `npm test` and the privacy test after the rewrite
 *   --denylist <file>     default: $EMERALD_DENYLIST, else ~/.emerald/denylist.txt
 *   --filter-repo <path>  git-filter-repo to run (an executable, or a .py run with $PYTHON
 *                         or python3); default: $GIT_FILTER_REPO, else `git filter-repo`
 *
 * It refuses the repository it lives in, anything that is not a fresh clone
 * (more than one reflog entry, a stash, local changes, a remote other than
 * origin), and any repository with a remote at the new public one.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NEW_NAME = 'Kfir Raphael Eliyahu'
const NEW_EMAIL = 'me@kfireliyahu.com'
const NEW_IDENTITY = `${NEW_NAME} <${NEW_EMAIL}>`
const NEW_REMOTE = /emerald-emd/i
/** The stand-in for a denylist line that names no replacement of its own. */
const PLACEHOLDER = '[removed]'
const BIG = 1 << 30

// ---------------------------------------------------------------- arguments

function usage(code) {
  console.log('usage: node scripts/rewrite-history.mjs <fresh-clone> [--run] [--no-test]')
  console.log('         [--denylist <file>] [--filter-repo <path>]')
  process.exit(code)
}

function parseArgs(argv) {
  const options = {
    target: null,
    run: false,
    test: true,
    denylist: process.env.EMERALD_DENYLIST ?? join(homedir(), '.emerald', 'denylist.txt'),
    filterRepo: process.env.GIT_FILTER_REPO ?? null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--run') options.run = true
    else if (arg === '--no-test') options.test = false
    else if (arg === '--denylist') options.denylist = argv[++i]
    else if (arg === '--filter-repo') options.filterRepo = argv[++i]
    else if (arg === '--help' || arg === '-h') usage(0)
    else if (arg.startsWith('--')) usage(2)
    else if (options.target === null) options.target = arg
    else usage(2)
  }
  if (options.target === null) usage(2)
  return options
}

// ---------------------------------------------------------------- output

/** Every string that must never be printed: terms, old addresses, old names. */
const secrets = { literals: [], regexes: [] }

function redact(text) {
  return text
    .split(/\r?\n/)
    .map((original) => {
      // The new identity is public, and an old name may be a part of it.
      const line = original.split(NEW_NAME).join('')
      const hit =
        secrets.literals.some((s) => line.includes(s)) ||
        secrets.regexes.some((re) => {
          re.lastIndex = 0
          return re.test(line)
        })
      return hit ? '    [line withheld: it holds a denylist term or an old identity]' : original
    })
    .join('\n')
}

function say(line = '') {
  console.log(redact(line))
}

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  say(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(message) {
  console.error(redact(`rewrite-history: ${message}`))
  process.exit(1)
}

// ---------------------------------------------------------------- git

function git(cwd, args, { allowFail = false, encoding = 'utf8' } = {}) {
  const r = spawnSync('git', args, { cwd, maxBuffer: BIG, encoding })
  if (r.error) fail(`could not run git: ${r.error.message}`)
  if (r.status !== 0 && !allowFail) {
    fail(`git ${args[0]} exited ${r.status}\n${String(r.stderr ?? '').trim()}`)
  }
  return allowFail ? r : r.stdout
}

function lines(text) {
  return text.split(/\r?\n/).filter((line) => line !== '')
}

function samePath(a, b) {
  const norm = (p) => realpathSync(p).replace(/\\/g, '/').replace(/\/$/, '')
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

// ---------------------------------------------------------------- the denylist

/** Same reading as src/privacy.test.ts: blank and `#` lines skipped, left of the first `==>`. */
function parseDenylist(text) {
  const entries = []
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === '' || raw.startsWith('#')) return
    const at = raw.indexOf('==>')
    const left = at === -1 ? raw : raw.slice(0, at)
    const right = at === -1 ? PLACEHOLDER : raw.slice(at + 3)
    if (left === '') return
    if (right.includes('==>') || /[\r\n]/.test(right)) {
      fail(`denylist line ${index + 1}: a replacement may not contain "==>"`)
    }
    if (left.startsWith('regex:')) {
      const source = left.slice('regex:'.length)
      let re
      try {
        re = new RegExp(source, 'g')
      } catch {
        fail(`denylist line ${index + 1}: the pattern does not compile`)
      }
      entries.push({ line: index + 1, kind: 'regex', source, re, right })
    } else {
      entries.push({ line: index + 1, kind: 'literal', text: left, bytes: Buffer.from(left, 'utf8'), right })
    }
  })
  return entries
}

function expressionsFile(entries, oldEmails) {
  const literals = entries
    .filter((e) => e.kind === 'literal')
    // Longest first, so a term that contains another is replaced whole.
    .sort((a, b) => b.bytes.length - a.bytes.length)
    .map((e) => `literal:${e.text}==>${e.right}`)
  const regexes = entries.filter((e) => e.kind === 'regex').map((e) => `regex:${e.source}==>${e.right}`)
  const emails = oldEmails.map((email) => `literal:${email}==>${NEW_EMAIL}`)
  return [...literals, ...emails, ...regexes].join('\n') + '\n'
}

// ---------------------------------------------------------------- identities

function identities(cwd) {
  const people = new Set(lines(git(cwd, ['log', '--all', '--format=%an <%ae>%n%cn <%ce>'])))
  const taggers = new Set(
    lines(git(cwd, ['for-each-ref', '--format=%(taggername) %(taggeremail)', 'refs/tags'])).filter(
      (line) => line.trim() !== '',
    ),
  )
  return { people, taggers, all: new Set([...people, ...taggers]) }
}

function splitIdentity(identity) {
  const m = /^(.*?) ?<([^>]*)>$/.exec(identity)
  return m ? { name: m[1], email: m[2] } : { name: identity, email: '' }
}

// ---------------------------------------------------------------- scanning

function countBytes(buf, needle) {
  let n = 0
  for (let at = buf.indexOf(needle); at !== -1; at = buf.indexOf(needle, at + needle.length)) n++
  return n
}

function makeCounter(terms) {
  return (buf) => {
    let hits = 0
    let text = null
    for (const term of terms) {
      if (term.bytes) hits += countBytes(buf, term.bytes)
      else {
        text ??= buf.toString('utf8')
        term.re.lastIndex = 0
        hits += text.match(term.re)?.length ?? 0
      }
    }
    return hits
  }
}

/** Streams `git cat-file --batch-all-objects --batch`: every object the clone holds, reachable or not. */
function scanObjects(cwd, counters) {
  return new Promise((done, broke) => {
    const child = spawn('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd })
    const result = {}
    for (const name of Object.keys(counters)) result[name] = { byType: {}, shas: new Set() }
    const objects = {}
    let pending = Buffer.alloc(0)
    let header = null
    child.stdout.on('data', (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
      for (;;) {
        if (!header) {
          const nl = pending.indexOf(10)
          if (nl === -1) break
          const [sha, type, size] = pending.subarray(0, nl).toString('latin1').split(' ')
          pending = pending.subarray(nl + 1)
          if (type === 'missing') continue
          header = { sha, type, size: Number(size) }
        }
        if (pending.length < header.size + 1) break
        const body = pending.subarray(0, header.size)
        objects[header.type] = (objects[header.type] ?? 0) + 1
        for (const [name, count] of Object.entries(counters)) {
          const n = count(body, header.type)
          if (n > 0) {
            const t = (result[name].byType[header.type] ??= { objects: 0, hits: 0 })
            t.objects++
            t.hits += n
            result[name].shas.add(header.sha)
          }
        }
        pending = pending.subarray(header.size + 1)
        header = null
      }
    })
    child.stderr.resume()
    child.on('error', broke)
    child.on('close', (code) =>
      code === 0 ? done({ objects, result }) : broke(new Error(`git cat-file exited ${code}`)),
    )
  })
}

function summarize(found) {
  const types = Object.entries(found.byType)
  if (types.length === 0) return '0'
  return types.map(([type, t]) => `${t.hits} in ${t.objects} ${type}${t.objects === 1 ? '' : 's'}`).join(', ')
}

function total(found) {
  return Object.values(found.byType).reduce((sum, t) => sum + t.hits, 0)
}

/** `git rev-list --all --objects`: what is reachable, and the paths of the trees. */
function reachable(cwd) {
  const shas = new Set()
  const paths = new Set()
  for (const line of lines(git(cwd, ['rev-list', '--all', '--objects']))) {
    const space = line.indexOf(' ')
    if (space === -1) shas.add(line)
    else {
      shas.add(line.slice(0, space))
      paths.add(line.slice(space + 1))
    }
  }
  return { shas, paths }
}

function intersect(set, other) {
  let n = 0
  for (const x of set) if (other.has(x)) n++
  return n
}

/**
 * Where a term is looked for. A blob whole; a commit or a tag only in its
 * message, because its headers are hashes, timestamps and the identity the
 * identity check covers; a tree not at all, because it is hashes and paths and
 * the paths are checked by name. Without this a digit pattern finds a hash.
 */
function content(body, type) {
  if (type === 'tree') return null
  if (type === 'commit' || type === 'tag') {
    const blank = body.indexOf('\n\n')
    return blank === -1 ? Buffer.alloc(0) : body.subarray(blank + 2)
  }
  return body
}

/**
 * The lines of `git log -p` that git writes itself — commit and index hashes,
 * dates, hunk ranges, modes — are left out of the term count for the same
 * reason; the message, the paths and every added, removed and context line stay.
 */
const GENERATED =
  /^(commit [0-9a-f]{7,}|Merge: |Date: |index [0-9a-f]+\.\.|@@ -\d|similarity index |dissimilarity index |(new|deleted) file mode |old mode |new mode )/

function logContent(buf) {
  const kept = buf
    .toString('utf8')
    .split('\n')
    .filter((line) => !GENERATED.test(line))
  return Buffer.from(kept.join('\n'), 'utf8')
}

async function survey(cwd, terms, oldEmails) {
  const countTerms = makeCounter(terms)
  const termCount = (body, type = 'blob') => {
    const text = content(body, type)
    return text === null ? 0 : countTerms(text)
  }
  const identityCount = makeCounter(oldEmails.map((email) => ({ bytes: Buffer.from(email, 'utf8') })))
  const scan = await scanObjects(cwd, { terms: termCount, identity: identityCount })
  const reach = reachable(cwd)
  const pathHits = [...reach.paths].filter((p) => termCount(Buffer.from(p, 'utf8')) > 0).length
  const logPatch = git(cwd, ['log', '--all', '-p', '--no-color', '--no-ext-diff', '--no-textconv'], {
    encoding: 'buffer',
  })
  const tree = git(cwd, ['rev-parse', 'HEAD^{tree}']).trim()
  const listing = new Map()
  for (const entry of git(cwd, ['ls-tree', '-r', '-z', 'HEAD']).split('\0')) {
    if (entry === '') continue
    const tab = entry.indexOf('\t')
    listing.set(entry.slice(tab + 1), entry.slice(0, tab))
  }
  return {
    commits: Number(git(cwd, ['rev-list', '--all', '--count']).trim()),
    branch: git(cwd, ['symbolic-ref', '--short', 'HEAD']).trim(),
    tree,
    listing,
    objects: scan.objects,
    terms: scan.result.terms,
    identity: scan.result.identity,
    reachableTermObjects: intersect(scan.result.terms.shas, reach.shas),
    pathHits,
    logPatch: { bytes: logPatch.length, terms: countTerms(logContent(logPatch)), identity: identityCount(logPatch) },
  }
}

function printSurvey(s) {
  say(`  commits: ${s.commits}; objects: ${Object.entries(s.objects).map(([t, n]) => `${n} ${t}`).join(', ')}`)
  say(`  HEAD: ${s.branch}, tree ${s.tree} (${s.listing.size} files)`)
  say(`  denylist hits, every object (blobs whole, commit and tag messages): ${summarize(s.terms)}; reachable objects with hits: ${s.reachableTermObjects}`)
  say(`  denylist hits in paths (rev-list --all --objects): ${s.pathHits}`)
  say(`  denylist hits in git log --all -p (${s.logPatch.bytes} bytes; git's own hash, date and hunk lines left out): ${s.logPatch.terms}`)
  say(`  old-address hits, every object: ${summarize(s.identity)}; in git log --all -p: ${s.logPatch.identity}`)
}

// ---------------------------------------------------------------- filter-repo

function filterRepoCommand(option) {
  if (!option) return { cmd: 'git', pre: ['filter-repo'] }
  if (/\.py$/i.test(option)) return { cmd: process.env.PYTHON ?? 'python3', pre: [option] }
  return { cmd: option, pre: [] }
}

function runFilterRepo(fr, cwd, args) {
  const r = spawnSync(fr.cmd, [...fr.pre, ...args], { cwd, maxBuffer: BIG, encoding: 'utf8' })
  return r
}

// ---------------------------------------------------------------- npm

/** `npm <args>`; the arguments are this script's own constants, so one command line is safe. */
function npm(cwd, args, env) {
  const r = spawnSync(['npm', ...args].join(' '), { cwd, env, maxBuffer: BIG, encoding: 'utf8', shell: true })
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  return { ok: r.status === 0, out }
}

function tail(text, n, pattern) {
  return lines(text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r(?!\n)/g, '\n'))
    .filter((line) => !pattern || pattern.test(line))
    .slice(-n)
}

// ---------------------------------------------------------------- main

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const target = resolve(options.target)
  const here = dirname(fileURLToPath(import.meta.url))

  // The denylist, and what it hashes to (so the run can be matched to the list).
  if (!existsSync(options.denylist)) fail('no denylist (set $EMERALD_DENYLIST or --denylist)')
  const denylistText = readFileSync(options.denylist, 'utf8')
  const entries = parseDenylist(denylistText)
  if (entries.length === 0) fail('the denylist has no entries')
  for (const e of entries) {
    if (e.kind === 'literal') secrets.literals.push(e.text)
    else secrets.regexes.push(new RegExp(e.source))
  }
  const denylistHash = createHash('sha256').update(denylistText).digest('hex').slice(0, 16)

  // Is it a git repository, and is it the one this script lives in?
  if (!existsSync(target)) fail('the clone does not exist')
  const top = git(target, ['rev-parse', '--show-toplevel'], { allowFail: true })
  if (top.status !== 0) fail('not a git repository')
  const root = top.stdout.trim()
  const ownTop = git(here, ['rev-parse', '--show-toplevel'], { allowFail: true })
  if (ownTop.status === 0 && samePath(ownTop.stdout.trim(), root)) {
    fail('refusing the working repository: clone it fresh (git clone --no-local) and point at the clone')
  }

  // Identities, before anything else is printed, so their addresses are withheld.
  const before = identities(root)
  const oldIdentities = [...before.all].filter((id) => id !== NEW_IDENTITY)
  const oldEmails = [...new Set(oldIdentities.map((id) => splitIdentity(id).email))].filter(
    (email) => email !== '' && email !== NEW_EMAIL,
  )
  const oldNames = [...new Set(oldIdentities.map((id) => splitIdentity(id).name))].filter(
    (name) => name !== '' && name !== NEW_NAME,
  )
  secrets.literals.push(...oldEmails, ...oldNames)

  say(`rewrite-history — ${options.run ? 'RUN' : 'dry run (add --run to rewrite)'}`)
  say(`  denylist: ${entries.length} entries (${entries.filter((e) => e.kind === 'regex').length} patterns), sha256 ${denylistHash}…`)
  say(`  identities: ${before.people.size} author/committer, ${before.taggers.size} tagger; ${oldIdentities.length} to rewrite to ${NEW_IDENTITY}`)
  say(`  old addresses: ${oldEmails.length}, also replaced wherever they appear in a file or a message`)

  // Is it a fresh clone?
  say('')
  say('Preflight')
  const remotes = lines(git(root, ['remote']))
  const urls = remotes.map((r) => git(root, ['remote', 'get-url', r], { allowFail: true }).stdout?.trim() ?? '')
  check('no remote is the new public repository', !urls.some((u) => NEW_REMOTE.test(u)))
  check('one remote, origin (filter-repo removes it)', remotes.length === 1 && remotes[0] === 'origin', `${remotes.length} remote(s)`)
  check('a .git directory, not a worktree', existsSync(join(root, '.git')) && statSync(join(root, '.git')).isDirectory())
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all']).trim()
  check('no local changes and no untracked files', dirty === '')
  check('no stash', git(root, ['rev-parse', '--verify', '--quiet', 'refs/stash'], { allowFail: true }).status !== 0)
  const refs = lines(git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads']))
  const busy = ['HEAD', ...refs].filter(
    (ref) => lines(git(root, ['reflog', 'show', '--format=%H', ref, '--'], { allowFail: true }).stdout ?? '').length > 1,
  )
  check('every branch has the one reflog entry a clone writes', busy.length === 0, `${busy.length} with more`)

  const fr = filterRepoCommand(options.filterRepo)
  const version = runFilterRepo(fr, root, ['--version'])
  const frOk = version.status === 0
  check('git-filter-repo runs', frOk, frOk ? `version ${version.stdout.trim()}` : 'install it: pip install git-filter-repo (see rewrite-history.md)')
  if (failures > 0) fail(`${failures} preflight check(s) failed; nothing was changed`)

  say('')
  say('Before')
  const s0 = await survey(root, entries, oldEmails)
  printSurvey(s0)
  if (s0.pathHits > 0) fail('a path holds a denylist term; --replace-text does not rename files. Rename it in a commit first.')

  if (!options.run) {
    say('')
    say(`Dry run: nothing changed. --run would rewrite ${oldIdentities.length} identit${oldIdentities.length === 1 ? "y" : "ies"} and apply`)
    say(`${entries.length + oldEmails.length} expressions to every file and every message, then check the result.`)
    return
  }

  // The rewrite. Its inputs live only in a temporary directory, deleted in `finally`.
  say('')
  say('Rewrite')
  const scratch = mkdtempSync(join(tmpdir(), 'emerald-rewrite-'))
  try {
    const mailmap = join(scratch, 'mailmap')
    const text = join(scratch, 'expressions')
    writeFileSync(
      mailmap,
      oldIdentities
        .map((id) => {
          const { name, email } = splitIdentity(id)
          return `${NEW_NAME} <${NEW_EMAIL}> ${name ? `${name} ` : ''}<${email}>`
        })
        .join('\n') + '\n',
    )
    writeFileSync(text, expressionsFile(entries, oldEmails))
    const r = runFilterRepo(fr, root, ['--mailmap', mailmap, '--replace-text', text, '--replace-message', text])
    const progress = /^(Parsed \d+ commits|Computing commit graph|Enumerating|Counting|Compressing|Writing|Total )/
    const said = tail(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, 1e9).filter((line) => !progress.test(line))
    for (const line of said.slice(-10)) say(`    ${line}`)
    if (r.status !== 0) fail(`git-filter-repo exited ${r.status}; see above`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  check('the mailmap and expressions are deleted', !existsSync(scratch))

  // The proof.
  say('')
  say('After')
  const after = identities(root)
  const s1 = await survey(root, entries, oldEmails)
  printSurvey(s1)
  say('')
  say('Checks')
  check('no remote is left on the clone', lines(git(root, ['remote'])).length === 0)
  check(
    "git log --all --format='%an <%ae>%n%cn <%ce>' | sort -u prints one identity",
    after.people.size === 1 && after.people.has(NEW_IDENTITY),
    after.people.size === 1 && after.people.has(NEW_IDENTITY) ? NEW_IDENTITY : `${after.people.size} identities`,
  )
  check('every tagger is that identity', [...after.taggers].every((t) => t === NEW_IDENTITY), `${after.taggers.size} tagger identit${after.taggers.size === 1 ? 'y' : 'ies'}`)
  check('no denylist term in any object the clone holds, reachable or not', total(s1.terms) === 0, summarize(s1.terms))
  check('no denylist term in any path', s1.pathHits === 0, String(s1.pathHits))
  check('no denylist term in git log --all -p', s1.logPatch.terms === 0, String(s1.logPatch.terms))
  check('no old address in any object or in git log --all -p', total(s1.identity) === 0 && s1.logPatch.identity === 0, `${total(s1.identity)} / ${s1.logPatch.identity}`)
  check('as many commits as before', s1.commits === s0.commits, `${s0.commits} → ${s1.commits}`)
  check('HEAD is the same branch', s1.branch === s0.branch, s1.branch)
  const changed = new Set()
  for (const [path, entry] of s0.listing) if (s1.listing.get(path) !== entry) changed.add(path)
  for (const path of s1.listing.keys()) if (!s0.listing.has(path)) changed.add(path)
  check(
    'the tree at HEAD is byte-identical apart from replaced text',
    [...changed].every((path) => s0.listing.has(path) && s1.listing.has(path)),
    s1.tree === s0.tree ? `identical: tree ${s1.tree}` : `${changed.size} path(s) changed by replacement`,
  )
  for (const path of [...changed].sort()) say(`        changed: ${path}`)

  if (options.test) {
    say('')
    say('Tests at HEAD (in the clone)')
    const env = { ...process.env, EMERALD_DENYLIST: resolve(options.denylist) }
    const ci = npm(root, ['ci', '--no-audit', '--no-fund'], env)
    check('npm ci', ci.ok)
    if (!ci.ok) for (const line of tail(ci.out, 15)) say(`    ${line}`)
    else {
      const all = npm(root, ['test'], env)
      for (const line of tail(all.out, 4, /Test Files|Tests |Duration/)) say(`    ${line.trim()}`)
      check('npm test', all.ok)
      if (!all.ok) for (const line of tail(all.out, 30, /FAIL|✗|×/)) say(`    ${line.trim()}`)
      const privacy = npm(root, ['test', '--', 'src/privacy.test.ts'], env)
      const ran = tail(privacy.out, 2, /Tests /).join(' ')
      check('the privacy test runs against the denylist and passes', privacy.ok && /[1-9][0-9]* passed/.test(ran) && !/skipped/.test(ran), ran.trim())
    }
  }

  say('')
  if (failures > 0) fail(`${failures} check(s) failed. Do not push this clone.`)
  say('All checks passed. The clone is ready to push to the new, empty repository (rewrite-history.md, step 6).')
}

main().catch((error) => fail(error?.stack ?? String(error)))
