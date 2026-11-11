import type { MessageKey } from '@/i18n/catalogue.ts'
import type { Translate } from '@/i18n/current.ts'
import type { CatalogTool, ToolGroup } from '@/plugin/catalog.ts'

/**
 * **A tool's sentence and a group's name, in the language now** (M60 U5,
 * D-590): the plugin's catalogue stays English — a host reads it — and the
 * screen asks `settings.assistants` by tool name and group, keeping the
 * catalogue's own word where it has none (`src/ui/mcp/words.test.ts`).
 */
function catalogueWord(t: Translate, key: string, own: string): string {
  const found = t(key as MessageKey)
  return found === key ? own : found
}

export function groupKey(group: Pick<ToolGroup, 'title'>): string {
  return group.title
    .split(/\s+/)
    .map((word, at) => (at === 0 ? word.toLowerCase() : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join('')
}

export function groupTitle(group: ToolGroup, t: Translate): string {
  return catalogueWord(t, `settings.assistants.groups.${groupKey(group)}`, group.title)
}

export function toolWords(tool: CatalogTool, t: Translate): string {
  return catalogueWord(t, `settings.assistants.tools.${tool.name}`, tool.plain)
}
