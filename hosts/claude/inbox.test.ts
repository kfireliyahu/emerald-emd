import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDocumentTool, formatRowsTool, NO_CLIENT, recordFormatRowsTool } from '@/plugin/host.ts'
import { tempDir } from '@/testing/tempDir'
import { PRINTED_NOT_DRAWN as HOOK_PRINTED_NOT_DRAWN, runHook } from './hooks/commands.ts'
import { statusText as hookStatusText } from './hooks/statusCache.ts'
import { ANSWERED_MARK, arrivedToast, inboxAnswer, inboxRows, PRINTED_NOT_DRAWN, type Told } from './mod/inboxText.ts'
import { statusText, unitsFromTable } from './mod/status.ts'

/**
 * **The hooks module says what the npx hooks say** (M56 U2, D-547): its inbox
 * rule, held to `runHook --once-per-session` on a real document; the lines it
 * copies from files it cannot import; and the gate, `hooks/unless-mod.mjs`,
 * which keeps the npx commands from starting where the module answered. The
 * module itself runs under `claude plugin test` (`mod/inbox.test.ts`).
 */
const HERE = fileURLToPath(new URL('.', import.meta.url))
const GATE = join(HERE, 'hooks', 'unless-mod.mjs')
const forward = (path: string) => path.split('\\').join('/')

async function aDocument(): Promise<string> {
  const path = join(await tempDir('emerald-inbox-'), 'memory.emd')
  await createDocumentTool.run({ path, packs: ['development'] }, { engineOnly: true })
  return path
}

async function send(path: string, subject: string): Promise<void> {
  const answer = await recordFormatRowsTool.run(
    { path, format: 'inbox', rows: [{ subject, from: 'F:/projects/notes/notes.emd', sent_on: '2026-11-03', state: 'new' }], commit: true },
    NO_CLIENT,
  )
  expect(answer).not.toMatch(/refus|cannot/i)
}

describe("the module's inbox is the npx hook's", () => {
  it('prints each new row in full once, then the count once, then nothing, and a later row alone', async () => {
    const path = await aDocument()
    await send(path, 'The first row')
    await send(path, 'The second row')
    let memory: Told = { told: [], said: '' }

    const both = async (): Promise<{ hook: string; mod: string }> => {
      const lines: string[] = []
      const code = await runHook(
        { command: 'rows', target: path, format: 'inbox', match: new Map([['state', 'new']]), once: true, session: 'one' },
        { line: (text) => lines.push(text), complain: (text) => lines.push(`!${text}`) },
      )
      expect(code).toBe(0)
      const text = await formatRowsTool.run({ path, format: 'inbox', match: { state: 'new' } }, NO_CLIENT)
      const answer = inboxAnswer(inboxRows(text), memory, forward(path), '')
      memory = answer.memory
      return { hook: lines.join('\n'), mod: answer.text }
    }

    const first = await both()
    expect(first.mod).toContain('The first row')
    expect(first.mod).toContain('The second row')
    expect(first.mod).toBe(first.hook)
    const second = await both()
    expect(second.mod).toBe('inbox (state=new): 2 rows in ' + forward(path) + ', every one printed in full earlier this session.')
    expect(second.mod).toBe(second.hook)
    expect(await both()).toEqual({ hook: '', mod: '' })

    await send(path, 'A row between prompts')
    const later = await both()
    expect(later.mod).toContain('; 2 of them printed earlier this session and not repeated')
    expect(later.mod).toContain('A row between prompts')
    expect(later.mod).not.toContain('The first row')
    expect(later.mod).toBe(later.hook)
  })

  it('reads a row by what it says, not its id, which a text document renews on every write', () => {
    const one = '2 rows of Inbox.\n\n**0a1b2c3d-0000-0000-0000-000000000001**\n- subject: Hello\n- state: new\n'
    const renewed = one.replace('0a1b2c3d-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000009')
    const [before] = inboxRows(one)
    const [after] = inboxRows(renewed)
    expect(before?.subject).toBe('Hello')
    expect(after?.mark).toBe(before?.mark)
    expect(inboxRows('No inbox rows match.\n\ninbox holds 17 rows; the filters are what excluded them.')).toEqual([])
  })

  it('raises a toast in the person’s words, naming the row when there is one', () => {
    const [row] = inboxRows('**0a1b2c3d-0000**\n- subject: Text refs sort as text\n- state: new')
    expect(arrivedToast(row === undefined ? [] : [row], 'F:/work/docs/memory.emd')).toBe("New in memory.emd's inbox: Text refs sort as text")
    expect(arrivedToast(inboxRows('**0a1b2c3d-0001**\n- subject: a\n\n**0a1b2c3d-0002**\n- subject: b'), '/w/p.emd')).toBe("2 new rows in p.emd's inbox")
  })
})

describe('what the module copies from files it cannot import', () => {
  it('opens start_here with the same line for the model', () => {
    expect(PRINTED_NOT_DRAWN).toBe(HOOK_PRINTED_NOT_DRAWN)
  })

  it('says the status line the status-line command says', () => {
    for (const parts of [{}, { inbox: 0 }, { inbox: 2, units: ['M56 U2'] }, { units: ['A', 'B', 'C', 'D'] }]) {
      expect(statusText(parts)).toBe(hookStatusText(parts))
    }
  })

  it('takes the units in progress from a table, the latest started first', () => {
    const table = '3 rows of Unit.\n\n| Id | ref | started |\n| --- | --- | --- |\n| 1 | M55 U5 | 2026-11-01 |\n| 2 | M56 U2 | 2026-11-03 |\n| 3 | M56 U3 | 2026-11-02 |'
    expect(unitsFromTable(table)).toEqual(['M56 U2', 'M56 U3', 'M55 U5'])
    expect(unitsFromTable('No unit rows match.')).toEqual([])
  })
})

/** Runs the gate before a command that writes what it was given to stdout; resolves with what came out and the code. */
function throughTheGate(input: string, command: readonly string[]): Promise<{ out: string; code: number | null }> {
  const child = spawn(process.execPath, [GATE, ...command], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
  child.stdin.end(input)
  return new Promise((settle) => child.on('close', (code) => settle({ out, code })))
}

describe('the gate in front of the npx hooks', () => {
  const echo = [process.execPath, '-e', "process.stdout.write('ran:' + require('fs').readFileSync(0, 'utf8')); process.exit(Number(process.argv[1] ?? 0))"]

  it('runs nothing where the module answered the event', async () => {
    const marked = JSON.stringify({ session_id: 's', hook_event_name: 'UserPromptSubmit', [ANSWERED_MARK]: true })
    expect(await throughTheGate(marked, echo)).toEqual({ out: '', code: 0 })
  })

  it('runs the command where nothing answered, with the same input, and never exits 2', async () => {
    const plain = JSON.stringify({ session_id: 's', hook_event_name: 'UserPromptSubmit' })
    expect(await throughTheGate(plain, echo)).toEqual({ out: `ran:${plain}`, code: 0 })
    expect(await throughTheGate('not json', echo)).toEqual({ out: 'ran:not json', code: 0 })
    expect((await throughTheGate(plain, [...echo, '2'])).code).toBe(1)
  })

  it('stands in front of both npx commands the plugin ships, and only those', async () => {
    const hooks = JSON.parse(await readFile(join(HERE, 'hooks', 'hooks.json'), 'utf8')) as { hooks: Record<string, { hooks: { command: string }[] }[]> }
    const commands = Object.values(hooks.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command)))
    const gated = commands.filter((command) => command.includes('unless-mod.mjs'))
    expect(gated).toHaveLength(2)
    expect(gated.every((command) => command.includes(' npx -y --prefer-offline -p emerald-mcp@'))).toBe(true)
    expect(commands.filter((command) => command.includes('npx ') && !command.includes('unless-mod.mjs'))).toEqual([])
  })
})
