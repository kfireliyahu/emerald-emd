import { useState } from 'react'

import { TOOL_GROUPS, type CatalogTool, type ToolGroup } from '@/plugin/catalog.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { connectSnippets } from '@/ui/mcp/connect.ts'
import { useKeptPacks } from '@/ui/packs.ts'
import { isWindows } from '@/ui/platform.ts'

/**
 * Talking to this document from an assistant (M26 U7, D-295).
 *
 * **A place in the rail and not a setting** — by choice: what an
 * assistant can do here is a way into the document, the same kind of answer
 * Formats is. The list is `plugin/catalog.ts`, which a test pins to the
 * server's own definitions, so the screen says what the server offers and
 * cannot quietly say something else.
 *
 * A pack's tools are shown when the document keeps the pack — the same
 * question the rail asks (M27 U7) — and the snippet drops `--engine-only` when
 * it keeps the ledger, the one pack with a half of the server of its own. The
 * development pack has none: its rows are written by the engine's tools.
 *
 * **One h1, buttons named for what they copy, and an effect in words** (M54
 * F6): *removes* is not a warning (D-531), so it is ink, not negative.
 */
export function Mcp() {
  const kept = useKeptPacks()
  // Read on every render; `documentName` is the reactive half, and it changes
  // whenever the path does — an open, a first save, a save-a-copy.
  useDocumentStore((state) => state.documentName)
  const adapter = useDocumentStore((state) => state.adapter)
  const documentPath = adapter.location?.()
  const snippets = connectSnippets({ documentPath, engineOnly: !kept.has('ledger'), windows: isWindows() })
  const groups = TOOL_GROUPS.filter((group) => group.half === 'engine' || kept.has(group.half))

  return (
    <div className="h-full overflow-auto px-6 py-4">
      <div className="max-w-4xl space-y-8">
        <section className="space-y-4">
          <h1 className="m-0 text-title">Assistants</h1>
          <p className="text-ink-secondary">
            An assistant on this machine can read and write this document through the tools below.
            Nothing goes through the app, and nothing leaves the machine but what you say in the
            conversation.
          </p>

          <Snippet label="Claude Code — run once in a terminal" copy="Copy the command" text={snippets.claudeCode} />
          <Snippet
            label="A desktop assistant — add to its MCP configuration"
            copy="Copy the configuration"
            text={snippets.desktop}
          />
          {snippets.firstMessage === undefined ? (
            <p className="text-caption text-ink-secondary">
              Save this document to a file and its path will be here, ready to tell the assistant.
            </p>
          ) : (
            <Snippet label="Then tell it which document" copy="Copy the sentence" text={snippets.firstMessage} />
          )}
          <p className="text-caption text-ink-secondary">
            The server is the npm package <code className="font-mono">emerald-mcp</code>: <code className="font-mono">npx</code>{' '}
            fetches it the first time, and it needs Node.
          </p>
        </section>

        {groups.map((group) => (
          <Group key={`${group.half}:${group.title}`} group={group} />
        ))}
      </div>
    </div>
  )
}

function Snippet({ label, copy: copyLabel, text }: { label: string; copy: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <span className="text-caption text-ink-secondary">{label}</span>
        <Button size="sm" variant="ghost" className="ms-auto" onClick={copy}>
          {copied ? 'Copied' : copyLabel}
        </Button>
      </div>
      <pre
        dir="ltr"
        className="overflow-x-auto whitespace-pre-wrap break-all border border-hairline bg-surface px-3 py-2 font-mono text-caption"
      >
        {text}
      </pre>
    </div>
  )
}

function Group({ group }: { group: ToolGroup }) {
  return (
    <section>
      <h2 className="flex items-baseline gap-3 font-medium">
        {group.title}
        {group.half === 'ledger' && (
          <span className="text-caption font-normal text-ink-secondary">the ledger</span>
        )}
      </h2>
      <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
        {group.tools.map((tool) => (
          <ToolLine key={tool.name} tool={tool} />
        ))}
      </ul>
    </section>
  )
}

const EFFECT_LOOK: Readonly<Record<CatalogTool['effect'], string>> = {
  reads: 'text-ink-secondary',
  writes: 'text-ink-secondary',
  removes: 'text-ink',
}

function ToolLine({ tool }: { tool: CatalogTool }) {
  return (
    <li className="flex items-baseline gap-4 py-1.5">
      <span className="flex-1">{tool.plain}</span>
      <span className={`w-16 shrink-0 text-caption ${EFFECT_LOOK[tool.effect]}`}>{tool.effect}</span>
      <code className="w-52 shrink-0 truncate font-mono text-caption text-ink-secondary">{tool.name}</code>
    </li>
  )
}
