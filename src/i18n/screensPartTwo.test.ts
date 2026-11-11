import { readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * **Every on-screen word of these places goes through the layer** — M60 U5
 * (D-583, D-590): Categories and its rules, Plan with the 50 / 30 / 20
 * proposal and its cushion, Settings, the guide, the rail and the title bar,
 * the app's dialogs and notices, the command palette and the shared
 * components. M60 U4 holds Home, Read files, Transactions and By merchant the
 * same way; this file is the second half's list, kept apart so the two merge.
 *
 * Read from the source, as `surfaceRules.test.ts` reads it: an English word
 * typed between two tags, or as the literal value of an attribute a person
 * reads or hears (`aria-label="Back"`), is a word Hebrew cannot reach. A word
 * asked for by its key (`t('rail.home')`) passes, and so does a document's own
 * word, which arrives as a value and never as a literal.
 */
const SCREENS = [
  'src/ui/screens/Categories.tsx',
  'src/ui/categories/AppearancePicker.tsx',
  'src/ui/categories/ParentPicker.tsx',
  'src/ui/screens/Rules.tsx',
  'src/ui/rules/ReapplyPanel.tsx',
  'src/ui/rules/RuleEditor.tsx',
  'src/ui/rules/TestBox.tsx',
  'src/ui/rules/Why.tsx',
  'src/ui/screens/Plan.tsx',
  'src/ui/plan/BucketTable.tsx',
  'src/ui/plan/FixedSection.tsx',
  'src/ui/plan/MonthRow.tsx',
  'src/ui/plan/PlanBar.tsx',
  'src/ui/plan/PointsAt.tsx',
  'src/ui/plan/StarterProposal.tsx',
  'src/ui/fixed/AmountHistory.tsx',
  'src/ui/fixed/CandidateCard.tsx',
  'src/ui/fixed/FixedExpenseEditor.tsx',
  'src/ui/savings/Cushion.tsx',
  'src/ui/screens/Packs.tsx',
  'src/ui/screens/Accounts.tsx',
  'src/ui/screens/LocalModel.tsx',
  'src/ui/screens/Calendar.tsx',
  'src/ui/screens/Language.tsx',
  'src/ui/screens/Export.tsx',
  'src/ui/screens/Mcp.tsx',
  'src/ui/guide/Guide.tsx',
  'src/ui/guide/GuideLine.tsx',
  'src/ui/Sidebar.tsx',
  'src/ui/RailFolder.tsx',
  'src/ui/HistoryArrows.tsx',
  'src/ui/TitleBar.tsx',
  'src/ui/DocumentBar.tsx',
  'src/ui/Notices.tsx',
  'src/ui/EarlierCopies.tsx',
  'src/ui/About.tsx',
  'src/ui/CommandPalette.tsx',
  'src/ui/components/CategoryPicker.tsx',
  'src/ui/components/ChoiceField.tsx',
  'src/ui/components/ContextMenu.tsx',
  'src/ui/components/FilterButton.tsx',
  'src/ui/components/PageMenu.tsx',
  'src/ui/components/ReadingBar.tsx',
  'src/ui/components/SelectOrNew.tsx',
  'src/ui/components/ThemeToggle.tsx',
  'src/ui/components/ViewTabs.tsx',
] as const

/** Names that are names in every language: the product, a key on the keyboard, a host. */
const NAMES = /^(?:Emerald|Ctrl|Shift|Alt|Esc|Enter|Tab|Cmd|SQLite|Git|GitHub|npm|Node|MCP|Claude(?: Code)?|ILS|USD|EUR)$/

const READ_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'label', 'caption', 'alt'])

/**
 * The English a person would meet in a file, read by the TypeScript parser:
 * JSX text with two Latin letters running, and a read attribute given as a
 * string literal. A word in an expression — `{t('rail.back')}`, a value — is
 * not text, so it passes.
 */
/** Text inside `<code>`, `<kbd>` or `<Kbd>` is a command or a key, the same in every language. */
function inCode(node: ts.Node): boolean {
  const parent = node.parent
  if (!ts.isJsxElement(parent)) return false
  const tag = parent.openingElement.tagName.getText()
  return tag === 'code' || tag === 'kbd' || tag === 'Kbd'
}

export function englishIn(source: string, file = 'screen.tsx'): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && !inCode(node)) {
      const text = node.text.replace(/\s+/g, ' ').trim()
      if (/[A-Za-z]{2,}/.test(text) && !NAMES.test(text)) found.push(text)
    } else if (ts.isJsxAttribute(node) && READ_ATTRIBUTES.has(node.name.getText(tree))) {
      const value = node.initializer
      if (value !== undefined && ts.isStringLiteral(value) && /[A-Za-z]{2,}/.test(value.text) && !NAMES.test(value.text)) {
        found.push(`${node.name.getText(tree)}="${value.text}"`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

describe('these places speak through the layer (M60 U5, D-590)', () => {
  it('finds a typed word, and passes a word asked for by its key', () => {
    expect(englishIn('<button aria-label="Back">Save</button>')).toEqual(['aria-label="Back"', 'Save'])
    expect(englishIn("<button aria-label={t('rail.back')}>{t('rail.save')}</button>")).toEqual([])
    expect(englishIn('<p><Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> <b>Emerald</b> <code>npx</code></p>')).toEqual([])
  })

  it.each(SCREENS)('%s types no English a person reads', (file) => {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8')
    expect(englishIn(source)).toEqual([])
  })
})
