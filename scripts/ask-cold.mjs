#!/usr/bin/env node
/**
 * **A cold read of the MCP server** (M42 F7): ask a stranger's model what
 * Emerald is, with nothing of this project's in reach but the built server.
 *
 *   npm run build:plugin
 *   node scripts/ask-cold.mjs [--only engine|full] [--model <m>] [--jobs <n>] [--out <file>]
 *
 * D-506 and D-507 were both found by a session at the maintainer's workplace
 * that read the server cold — *built for money first*, then *its main strength
 * is checking numbers add up* — and neither by this project. This does that
 * read on purpose. Each question is its own fresh `claude -p`, run in a new
 * empty temp folder (so no CLAUDE.md, skill, memory or settings of this repo's
 * reach it), with `--strict-mcp-config` and an `--mcp-config` naming only
 * `node <repo>/dist-plugin/server.mjs`, once `--engine-only` and once without.
 * Settings load from `project` only, which that empty folder has none of, so
 * the user's own hooks and plugins stay out too; and built-in tools are off,
 * so what the model says comes from the server's text and its tools alone.
 *
 * For every answer it prints the tools the model called, the **red flags**
 * matched mechanically — the phrasings D-506 and D-507 fixed — and which of
 * the things those decisions say the server should convey the answer said.
 * A flag is a prompt for judgment, not a failure: the full server names the
 * ledger, and *add up* can be said rightly. **The session running this reads
 * the answers** and judges the rest against D-506 and D-507.
 *
 * The answers are written outside the repository (the OS temp folder unless
 * `--out` says where), never into it. **A maintainer's and session's tool
 * only**: it calls the Claude API through the user's own `claude` CLI, so it
 * never runs in CI and nothing in src/ imports it. The app and the server
 * still make no network call (D-124) — the network is the CLI's, here.
 *
 * The questions are a list below so it grows: when a session somewhere gets
 * Emerald wrong, its question goes in.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const server = join(root, 'dist-plugin', 'server.mjs')

/** What a stranger asks first. Add the question a session got wrong. */
const QUESTIONS = [
  'What is Emerald, and what is it best at?',
  'I keep my work notes in an Obsidian vault: daily notes, tasks with due dates, meetings, people, projects. Should I move them into Emerald? Why or why not?',
  "I have a CSV of the books I've read. What can you do with it here?",
  'My notes have no numbers in them. Is Emerald still useful?',
  'What would you call first in a new project?',
]

/** The phrasings D-506 and D-507 took out of the server, and their near kin. Matched per sentence. */
const FLAGS = [
  ['money first', /\b(money|finance|financ\w*)[- ](first|focused|centric)\b|\bbuilt (primarily |mainly |mostly )?(for|around) (money|financ|personal financ|budget)/i],
  ['finance (right only as one optional pack)', /\bfinanc(e|es|ial)\b|\bbudget\w*/i],
  ['primarily for', /\b(primarily|mainly|mostly|chiefly) (a |an )?(for |about )?(financ|money|budget|ledger|numbers|figures|numeric|accounting)/i],
  ['built for', /\b(built|designed|made) (primarily |mainly |specifically )?for\b/i],
  ['main strength is checking', /\bmain (strength|point|value|purpose|selling point)\b[^.]{0,80}\b(check|add up|validat|verif|consisten|numbers|figures)/i],
  ['best at checking', /\b(best at|strongest at|shines|excels)\b[^.]{0,80}\b(check|add up|validat|verif|numbers|figures|totals)/i],
  ['add up', /\badds? up\b|\bmust agree\b|\breconcil\w*/i],
  ['numbers as the reason', /\b(no|without|lack\w*|don't have|do not have|aren't|isn't|absent)\b[^.]{0,60}\b(numbers|figures|numeric|amounts|calculations|math)\b/i],
  ['not designed for', /\b(not|isn't|wasn't|aren't) (really |primarily |specifically )?(designed|built|meant|intended|made|suited|ideal|a fit) for\b/i],
  ['against moving notes', /\b(wouldn't|would not|don't|do not|not) (recommend |suggest |advise )?(moving|migrating|switching|move|migrate|switch)\b|\bnot worth (it|the)\b|\b(stay|stick) with obsidian\b/i],
]

/** What D-506 and D-507 say the server should convey. A hint for the judgment, never the judgment. */
const CONVEYS = [
  ['any kind of thing', /\bany (kind|sort|type) of\b|\banything (you|a person|they) (keep|track)|\bkind of thing\b/i],
  ['asks for rows instead of re-reading', /\binstead of (re-?reading|reading|grepping|searching|opening)|\brather than (re-?reading|reading|grepping)|\bre-?read|\bask(s|ing)? for (the )?(matching )?rows|\bone call\b/i],
  ['typed fields', /\btyped\b|\breal types\b|\bfilters? exactly\b|\bexact filter/i],
  ['links', /\blinks?\b|\blinked\b/i],
  ['every session sees the same rows', /\bevery session\b|\bsame rows\b|\bacross sessions\b|\beach session\b|\bnext session\b/i],
  ['a Markdown folder read in place', /\b(in place|where (it|they) (is|are|live)|never (changed|modified|touched)|read-only|without (moving|changing|touching))\b/i],
  ['packs optional', /\bpacks?\b/i],
]

function option(name) {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const only = option('--only')
const model = option('--model')
const jobs = Math.max(1, Number(option('--jobs') ?? 5))
const modes = [
  { name: 'engine-only', args: ['--engine-only'] },
  { name: 'full', args: [] },
].filter((mode) => !only || mode.name.startsWith(only))

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const out = resolve(option('--out') ?? join(tmpdir(), 'emerald-ask-cold', `${stamp}.md`))
const fromRoot = relative(root, out)
if (!fromRoot.startsWith('..') && !isAbsolute(fromRoot)) {
  console.error(`ask-cold: ${out} is inside the repository; the answers are written outside it (--out <file>)`)
  process.exit(1)
}
if (!existsSync(server)) {
  console.error('ask-cold: dist-plugin/server.mjs is missing; run `npm run build:plugin` first')
  process.exit(1)
}

/** The newest file under a folder, so a server older than its source says so. */
function newest(folder) {
  let latest = 0
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs)
  }
  return latest
}
if (newest(join(root, 'src', 'plugin')) > statSync(server).mtimeMs) {
  console.warn('ask-cold: src/plugin/ changed after dist-plugin/server.mjs was built — `npm run build:plugin` first, or this reads the old text\n')
}

/**
 * The environment of a stranger's terminal. Run from inside a Claude session, its
 * variables would make the child that session's — its entry point, its simple
 * mode, its messaging socket — so every `CLAUDE*` and `MCP_*` one goes but the
 * two that say whose account and config this is. And `-p` may start the first
 * turn before the server has connected (the desktop app sets
 * `MCP_CONNECTION_NONBLOCKING`), when the model knows no Emerald at all; it waits.
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(CLAUDE|MCP_)/i.test(key) || /^(CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR)$/i.test(key)),
)
env.MCP_CONNECTION_NONBLOCKING = 'false'

/** One question, one fresh run in its own empty folder. */
function ask(mode, question) {
  const folder = mkdtempSync(join(tmpdir(), 'cold-read-'))
  const configFolder = mkdtempSync(join(tmpdir(), 'cold-read-config-'))
  const config = join(configFolder, 'mcp.json')
  writeFileSync(config, JSON.stringify({ mcpServers: { emerald: { command: process.execPath, args: [server, ...mode.args] } } }))
  const args = [
    '-p',
    '--strict-mcp-config',
    '--mcp-config', config,
    '--setting-sources', 'project',
    '--tools', '',
    '--allowedTools', 'mcp__emerald',
    '--no-session-persistence',
    '--output-format', 'stream-json',
    '--verbose',
    ...(model ? ['--model', model] : []),
  ]
  return new Promise((done) => {
    const child = spawn('claude', args, { cwd: folder, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => (stderr += String(error)))
    child.on('close', (code) => {
      rmSync(folder, { recursive: true, force: true })
      rmSync(configFolder, { recursive: true, force: true })
      done(read(mode, question, code, stdout, stderr))
    })
    child.stdin.end(question)
  })
}

/** What the run's stream says: whether the server was there, what was called, the answer. */
function read(mode, question, code, stdout, stderr) {
  const run = { mode: mode.name, question, code, servers: [], tools: 0, builtIn: [], called: [], answer: '', cost: 0, model: '', error: '' }
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'system' && event.subtype === 'init') {
      run.servers = event.mcp_servers ?? []
      run.tools = (event.tools ?? []).filter((tool) => tool.startsWith('mcp__')).length
      run.builtIn = (event.tools ?? []).filter((tool) => !tool.startsWith('mcp__'))
      run.model = event.model ?? ''
    }
    if (event.type === 'assistant') {
      for (const part of event.message?.content ?? []) {
        if (part.type === 'tool_use') {
          run.called.push(part.name.startsWith('mcp__emerald__') ? part.name.slice(14) : `${part.name} (not offered)`)
        }
      }
    }
    if (event.type === 'result') {
      run.answer = event.result ?? ''
      run.cost = event.total_cost_usd ?? 0
      if (event.is_error) run.error = run.answer
    }
  }
  const others = run.servers.filter((s) => s.name !== 'emerald')
  if (run.builtIn.length) run.error = `built-in tools reached the run: ${run.builtIn.join(', ')}`
  else if (others.length) run.error = `other MCP servers reached the run: ${others.map((s) => s.name).join(', ')}`
  else if (!run.servers.some((s) => s.name === 'emerald' && s.status === 'connected') && !run.called.length) {
    run.error ||= `the emerald server was ${run.servers[0]?.status ?? 'absent'} when the run began`
  }
  if (code !== 0 && !run.error) run.error = stderr.trim().slice(0, 400) || `claude exited ${code}`
  run.flags = matches(run.answer, FLAGS)
  run.conveys = CONVEYS.filter(([, pattern]) => pattern.test(run.answer)).map(([label]) => label)
  return run
}

/** Every flag, with the sentence it matched in. */
function matches(text, patterns) {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim())
  const found = []
  for (const [label, pattern] of patterns) {
    for (const sentence of sentences) {
      if (pattern.test(sentence)) found.push({ label, sentence: sentence.trim().slice(0, 240) })
    }
  }
  return found
}

/** At most `jobs` runs at once, and a run that found no server is tried once more. */
async function runAll(tasks) {
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const at = next++
      let run = await ask(...tasks[at])
      if (run.error?.startsWith('the emerald server')) run = await ask(...tasks[at])
      results[at] = run
      process.stderr.write(`  ${run.mode} · ${at % QUESTIONS.length + 1}/${QUESTIONS.length} ${run.error ? 'failed' : 'answered'}\n`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker))
  return results
}

const tasks = modes.flatMap((mode) => QUESTIONS.map((question) => [mode, question]))
console.error(`ask-cold: ${tasks.length} fresh runs against ${relative(root, server)} (${modes.map((m) => m.name).join(', ')})`)
const runs = await runAll(tasks)

const lines = [`# A cold read of the Emerald MCP server, ${stamp}`, '', `Server: \`${server}\``, '']
for (const mode of modes) {
  lines.push(`## ${mode.name}`, '')
  for (const run of runs.filter((r) => r.mode === mode.name)) {
    lines.push(`### ${run.question}`, '')
    lines.push(`- model: ${run.model || '?'} · emerald tools offered: ${run.tools} · cost: $${run.cost.toFixed(3)}`)
    lines.push(`- called: ${run.called.length ? run.called.join(', ') : 'nothing'}`)
    if (run.error) lines.push(`- **FAILED**: ${run.error}`)
    lines.push(`- red flags: ${run.flags.length ? '' : 'none'}`)
    for (const flag of run.flags) lines.push(`  - **${flag.label}**: “${flag.sentence}”`)
    const missing = CONVEYS.map(([label]) => label).filter((label) => !run.conveys.includes(label))
    lines.push(`- said: ${run.conveys.join(', ') || 'none of them'}`)
    lines.push(`- did not say: ${missing.join(', ') || 'nothing missing'}`)
    lines.push('', run.answer.trim().replace(/^/gm, '> '), '')
  }
}
const flagged = runs.filter((run) => run.flags.length).length
const failed = runs.filter((run) => run.error).length
const cost = runs.reduce((sum, run) => sum + run.cost, 0)
lines.push('---', '', `${runs.length} runs · ${flagged} with a red flag · ${failed} failed · $${cost.toFixed(2)}`)
lines.push('', 'Judge each answer against D-506 and D-507: any kind of thing; a model asks for rows instead of re-reading files; typed fields and links; every session sees the same rows; checks one benefit, never the reason; a folder of Markdown notes read where it is; packs optional.')

const report = `${lines.join('\n')}\n`
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, report)
console.log(report)
console.error(`ask-cold: written to ${out}`)
process.exit(failed ? 1 : 0)
