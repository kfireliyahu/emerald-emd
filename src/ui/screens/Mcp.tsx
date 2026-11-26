import { useState } from 'react'

import { countKey } from '@/i18n/count.ts'

import { useT, type Translate } from '@/i18n/current.ts'
import { TOOL_GROUPS, type CatalogTool, type ToolGroup } from '@/plugin/catalog.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { connectSnippets } from '@/ui/mcp/connect.ts'
import { groupTitle, toolWords } from '@/ui/mcp/words.ts'
import { useKeptPacks } from '@/ui/packs.ts'
import { isWindows } from '@/ui/platform.ts'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { SettingsPage } from '@/ui/settings/SettingsPage.tsx'

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
 *
 * **The report** (M64 U12, D-624): the answer first — how many tools an
 * assistant reaches this document through — then the way to connect one, and
 * the tools as a short list of their groups, **each opening its tools beside
 * the page** (the `SidePanel`) rather than eleven lists down five windows.
 */
export function Mcp() {
  const t = useT()
  const kept = useKeptPacks()
  // Read on every render; `documentName` is the reactive half, and it changes
  // whenever the path does — an open, a first save, a save-a-copy.
  useDocumentStore((state) => state.documentName)
  const adapter = useDocumentStore((state) => state.adapter)
  const documentPath = adapter.location?.()
  const snippets = connectSnippets({ documentPath, engineOnly: !kept.has('ledger'), windows: isWindows() })
  const groups = TOOL_GROUPS.filter((group) => group.half === 'engine' || kept.has(group.half))
  const tools = groups.reduce((sum, group) => sum + group.tools.length, 0)
  /** The group whose tools are open beside the page, by its key. */
  const [open, setOpen] = useState<string | undefined>()
  const shown = groups.find((group) => keyOf(group) === open)

  return (
    <SettingsPage
      title={t('rail.assistants')}
      answer={t(countKey('settings.assistants.answer', tools), { count: tools })}
      aside={
        shown === undefined ? undefined : (
          <SidePanel title={groupTitle(shown, t)} onClose={() => setOpen(undefined)}>
            <ul className="m-0 list-none divide-y divide-hairline border-y border-hairline p-0">
              {shown.tools.map((tool) => (
                <ToolLine key={tool.name} tool={tool} t={t} />
              ))}
            </ul>
          </SidePanel>
        )
      }
    >
      <section aria-labelledby="assistants-connect" className="flex flex-col gap-4">
        <h2 id="assistants-connect" className="m-0 text-heading font-medium">
          {t('settings.assistants.connect')}
        </h2>
        <p className="m-0 -mt-2 text-ink-secondary">{t('settings.assistants.private')}</p>
        <Snippet
          label={t('settings.assistants.claudeCode')}
          copy={t('settings.assistants.copyCommand')}
          text={snippets.claudeCode}
        />
        <Snippet
          label={t('settings.assistants.desktop')}
          copy={t('settings.assistants.copyConfiguration')}
          text={snippets.desktop}
          folded
        />
        {snippets.firstMessage === undefined ? (
          <p className="m-0 text-caption text-ink-secondary">{t('settings.assistants.savePath')}</p>
        ) : (
          <Snippet
            label={t('settings.assistants.tellIt')}
            copy={t('settings.assistants.copySentence')}
            text={documentPath === undefined ? snippets.firstMessage : t('settings.assistants.firstMessage', { path: documentPath })}
          />
        )}
        <p className="m-0 text-caption text-ink-secondary">
          <Phrase
            text={t('settings.assistants.server')}
            parts={{ pkg: <code className="font-mono">emerald-mcp</code>, npx: <code className="font-mono">npx</code> }}
          />
        </p>
      </section>

      <section aria-labelledby="assistants-tools" className="mt-8 flex flex-col">
        <h2 id="assistants-tools" className="m-0 mb-2 text-heading font-medium">
          {t('settings.assistants.canDo')}
        </h2>
        {/* A short list of the groups, each opening its tools beside the page (M64 U12). */}
        <ul className="m-0 list-none border-t border-hairline p-0" data-block>
          {groups.map((group) => {
            const key = keyOf(group)
            const on = key === open
            return (
              <li key={key} className="border-b border-hairline">
                <button
                  type="button"
                  aria-expanded={on}
                  onClick={() => setOpen(on ? undefined : key)}
                  className={`flex h-10 w-full items-center gap-3 px-3 text-start transition-colors duration-[var(--duration-micro)] ${on ? 'fc-row-on' : 'hover:bg-surface'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{groupTitle(group, t)}</span>
                  {group.half === 'ledger' && (
                    <span className="shrink-0 text-caption text-ink-secondary">{t('settings.assistants.ledger')}</span>
                  )}
                  <span className="w-20 shrink-0 text-end text-ink-secondary tabular-nums">
                    {t(countKey('settings.assistants.toolCount', group.tools.length), { count: group.tools.length })}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </SettingsPage>
  )
}

/** A group's key: its half and its title, which is unique within the half. */
function keyOf(group: ToolGroup): string {
  return `${group.half}:${group.title}`
}

/**
 * A snippet to copy. `folded`, a tall one shows its first lines until *Show it*:
 * copying needs none of it read, and it kept what an assistant can do below
 * the first screen (M64 U12).
 */
function Snippet({ label, copy: copyLabel, text, folded = false }: { label: string; copy: string; text: string; folded?: boolean }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(!folded)
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
        {folded && (
          <button type="button" className="fc-text-action ms-auto" aria-expanded={shown} onClick={() => setShown(!shown)}>
            {shown ? t('settings.assistants.hideIt') : t('settings.assistants.showIt')}
          </button>
        )}
        <button type="button" className={`fc-text-action ${folded ? '' : 'ms-auto'}`} onClick={copy}>
          {copied ? t('settings.assistants.copied') : copyLabel}
        </button>
      </div>
      <pre
        dir="auto"
        className={`m-0 overflow-x-auto whitespace-pre-wrap break-all border border-hairline bg-surface px-3 py-2 font-mono text-caption ${shown ? '' : 'max-h-16 overflow-y-hidden'}`}
      >
        {text}
      </pre>
    </div>
  )
}

const EFFECT_LOOK: Readonly<Record<CatalogTool['effect'], string>> = {
  reads: 'text-ink-secondary',
  writes: 'text-ink-secondary',
  removes: 'text-ink',
}

/** A tool, in its group's panel: what it does, then whether it reads, writes or removes, and its name. */
function ToolLine({ tool, t }: { tool: CatalogTool; t: Translate }) {
  return (
    <li className="flex flex-col gap-0.5 py-2">
      <span>{toolWords(tool, t)}</span>
      <span className="flex items-baseline gap-3 text-caption">
        <span className={EFFECT_LOOK[tool.effect]}>{t(`settings.assistants.effects.${tool.effect}`)}</span>
        <code className="min-w-0 truncate font-mono text-ink-secondary">{tool.name}</code>
      </span>
    </li>
  )
}
