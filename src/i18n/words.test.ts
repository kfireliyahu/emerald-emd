import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * **A translated screen's words go through the layer** — M60 U4 (D-589), the
 * `rule` row *A translated screen's words are the catalogue's*.
 *
 * Every file of a screen in the translated set draws its words with `t()`
 * from `src/i18n/`, so Hebrew reaches every word of it and English stays the
 * source. An English word written inline in one of these files — JSX text, a
 * `title`, an `aria-label`, a label in a menu's items, a sentence a helper
 * returns — is a word Hebrew never reaches, and this fails on it with its file
 * and line.
 *
 * What a document holds is not a word of the app's: a merchant, an account, a
 * category or a cell read from a statement is rendered as it was written,
 * through `Bidi`. A literal that is such a value, or is no word at all (a key's
 * name, a code compared against), goes in `ALLOWED` with why.
 */

/** M60 U4: Home with its Year tab and Getting started line, Read files and the import screen, Transactions with its pane and menus, By merchant. */
const U4 = [
  'src/ui/screens/Home.tsx',
  'src/ui/screens/Year.tsx',
  'src/ui/home/WaitingList.tsx',
  'src/ui/home/HomePanel.tsx',
  'src/ui/home/parts.tsx',
  'src/ui/guide/GuideLine.tsx',
  'src/ui/screens/ReadStatements.tsx',
  // M64 U7 (D-619): the rest of reading files, translated as it was redesigned.
  'src/ui/import/GapPanel.tsx',
  'src/ui/screens/Readers.tsx',
  'src/ui/paychecks/ReadSlips.tsx',
  'src/ui/paychecks/SlipBatchBar.tsx',
  'src/ui/components/ConfirmAtButton.tsx',
  'src/ui/import/MapperScreen.tsx',
  'src/ui/import/MappingBar.tsx',
  'src/ui/import/PreviewStrip.tsx',
  'src/ui/import/ReadFilesBar.tsx',
  'src/ui/import/SettlementPrompt.tsx',
  'src/ui/import/SheetGrid.tsx',
  'src/ui/import/StageBar.tsx',
  'src/ui/import/TransferPrompt.tsx',
  'src/ui/import/roleLabel.ts',
  'src/ui/screens/Transactions.tsx',
  'src/ui/transactions/DetailPanel.tsx',
  'src/ui/transactions/FilterBar.tsx',
  'src/ui/transactions/LearningOffer.tsx',
  'src/ui/screens/ByMerchant.tsx',
]

/**
 * M60 U5: Categories and its rules, Plan with the 50 / 30 / 20 proposal and its cushion, Settings,
 * the guide, the rail and the title bar, the app's dialogs and notices, the command palette and the
 * shared components (D-590; folded in from its own test by M60 F1).
 */
const U5 = [
  'src/ui/screens/Categories.tsx',
  'src/ui/categories/AppearancePicker.tsx',
  'src/ui/categories/ParentPicker.tsx',
  'src/ui/screens/Rules.tsx',
  'src/ui/rules/ReapplyPanel.tsx',
  'src/ui/rules/RuleEditor.tsx',
  'src/ui/rules/TestBox.tsx',
  'src/ui/rules/Why.tsx',
  'src/ui/screens/Plan.tsx',
  'src/ui/plan/BucketEditor.tsx',
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
]

/** The screens whose words are the catalogue's. A unit that translates a screen adds its files here. */
export const TRANSLATED: readonly string[] = [...U4, ...U5]

/** Literals in a translated file that are not the app's words, by file, each with why. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // The English sentence's object, built from the pack's title; the Hebrew word
  // names the pack by `{title}` and never reads it.
  'src/ui/screens/Packs.tsx': ['the pack'],
  // A state the function returns and its caller compares — never shown.
  'src/ui/HistoryArrows.tsx': ['stepped back'],
  // A run's note is a record the document keeps, written as it was made and
  // shown later as the document's own words — never a word of this screen.
  'src/ui/screens/Transactions.tsx': ['— from a correction'],
  'src/ui/screens/ByMerchant.tsx': ['By merchant:'],
}

/** Names a keyboard gives its keys, which are compared against and never shown. */
const KEY_NAMES = new Set([
  'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control', 'Ctrl', 'Meta', 'Alt', 'ContextMenu', 'F10', 'Space',
])

/** Names that are names in every language: the product. A key's name is in `<Kbd>` or `<Key>`. */
const NAMES = new Set(['Emerald'])

/** Elements whose text is a key or a command, the same in every language (M60 U5's rule, kept by F1). */
const CODE_TAGS = new Set(['code', 'kbd', 'Kbd', 'Key'])

/** A string that is CSS — a colour mixed, a transform, a fill by url — and never a word. */
const CSS = /(?:^|[\s(])(?:url|color-mix|translate|rotate|scale|var|calc|rgba?|hsla?|(?:repeating-)?(?:linear|radial)-gradient)\(/

/** Properties that hold a key's name or a shortcut, never a sentence. */
const KEY_PROPERTIES = /^['"]?(?:shortcut|aria-keyshortcuts)['"]?$/

/** Attributes that never hold a word. */
const NOT_WORDS = /^(className|key|to|href|id|type|role|d|viewBox|style|htmlFor|name|dir|lang|inputMode|autoComplete|accept|data-.*|aria-(controls|labelledby|describedby|owns|hidden|expanded|selected|checked|pressed|current|live|haspopup|keyshortcuts|activedescendant|sort|orientation|level|posinset|setsize|valuenow|valuemin|valuemax))$/

/** Attributes that only ever hold words. */
const WORDS = /^(title|aria-label|aria-description|aria-roledescription|aria-valuetext|placeholder|alt|label)$/

/** Calls whose string arguments are never shown. */
const NOT_SHOWN_CALLS = /^(cn|clsx|t|translate|countKey|navigate|fill|say|useT|lookup|console\.\w+|.*\.(querySelector|querySelectorAll|closest|addEventListener|removeEventListener|getAttribute|setAttribute|removeAttribute|startsWith|endsWith|includes|indexOf|split|join|replace|replaceAll|padStart|padEnd|localeCompare|matches|toggle|add|remove|has|get|set|delete|test|exec|match|getPropertyValue|setProperty|setData|getData|dispatchEvent|scrollIntoView|focus))$/

/** One space-separated token of a class list rather than of a sentence. */
const UTILITY = new Set([
  'flex', 'grid', 'block', 'hidden', 'inline', 'contents', 'relative', 'absolute', 'fixed', 'sticky', 'static',
  'truncate', 'uppercase', 'lowercase', 'capitalize', 'italic', 'underline', 'border', 'rounded', 'shadow',
  'transition', 'group', 'peer', 'invisible', 'visible', 'isolate', 'grow', 'shrink', 'outline', 'ring', 'bidi',
  'table', 'table-row', 'resize', 'contain', 'antialiased', 'container', 'collapse', 'transform',
])

function textOf(node: ts.StringLiteralLike | ts.TemplateExpression): string {
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ')
  return node.text
}

/** Whether a literal reads as words to a person, rather than as a class list, a code or a key. */
function looksLikeWords(text: string, alone: boolean): boolean {
  const trimmed = text.trim()
  if (!/[A-Za-z]{2}/.test(trimmed)) return false
  if (/^[A-Z0-9_]+$/.test(trimmed) || KEY_NAMES.has(trimmed) || NAMES.has(trimmed) || CSS.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/)
  const sentence = tokens.some((token) => /^[A-Za-z’'()]+[,.:;!?…)]*$/.test(token) && !UTILITY.has(token.toLowerCase()))
  if (tokens.length > 1) return sentence && !tokens.every((token) => /[-:[\]/\d]/.test(token) || UTILITY.has(token))
  if (/^[A-Z][a-z’']+/.test(trimmed)) return true
  return alone && /^[a-z’']+[.…]?$/.test(trimmed)
}

function attributeOf(node: ts.Node): string | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isJsxAttribute(at)) return at.name.getText()
    if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at) || ts.isJsxFragment(at)) return undefined
  }
  return undefined
}

/** Whether a literal sits where it is shown on its own: a JSX child, or a branch of one. */
function isChild(node: ts.Node): boolean {
  let at: ts.Node = node
  while (ts.isConditionalExpression(at.parent) || ts.isBinaryExpression(at.parent) || ts.isParenthesizedExpression(at.parent)) {
    if (ts.isBinaryExpression(at.parent) && ![ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(at.parent.operatorToken.kind)) return false
    if (ts.isConditionalExpression(at.parent) && at.parent.condition === at) return false
    at = at.parent
  }
  return ts.isJsxExpression(at.parent) && !ts.isJsxAttribute(at.parent.parent)
}

function notShown(node: ts.Node): boolean {
  const parent = node.parent
  if (ts.isLiteralTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true
  if (ts.isCaseClause(parent) || ts.isElementAccessExpression(parent)) return true
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind)) return true
  for (let at: ts.Node = parent; !ts.isSourceFile(at); at = at.parent) {
    if (ts.isCallExpression(at) && NOT_SHOWN_CALLS.test(at.expression.getText())) return true
    if (ts.isNewExpression(at) && /Error$/.test(at.expression.getText())) return true
    if (ts.isVariableDeclaration(at) && /class|Class|CLASS|LOOK|Look|look|STYLE|PATTERN|RE$/.test(at.name.getText())) return true
    if (ts.isPropertyAssignment(at) && /class|Class|style/.test(at.name.getText())) return true
    if (ts.isPropertyAssignment(at) && KEY_PROPERTIES.test(at.name.getText())) return true
    if (ts.isJsxAttribute(at)) return NOT_WORDS.test(at.name.getText())
    if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)) return false
  }
  return false
}

/** The inline words in a source: `line: text`, one per word a person would read. */
export function inlineWords(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: string[] = []
  const allowed = new Set(ALLOWED[file] ?? [])
  const report = (node: ts.Node, text: string): void => {
    if (allowed.has(text.trim().replace(/\s+/g, ' '))) return
    found.push(`${String(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)}: ${text.trim().replace(/\s+/g, ' ')}`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const parent = node.parent
      const code = ts.isJsxElement(parent) && CODE_TAGS.has(parent.openingElement.tagName.getText())
      if (/[A-Za-z]/.test(node.text) && !code && !NAMES.has(node.text.trim())) report(node, node.text)
      return
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      if (!notShown(node)) {
        const text = textOf(node)
        const attribute = attributeOf(node)
        const words =
          attribute !== undefined && WORDS.test(attribute)
            ? /[A-Za-z]{2}/.test(text) && !KEY_NAMES.has(text.trim()) && !NAMES.has(text.trim())
            : looksLikeWords(text, isChild(node))
        if (words) report(node, text)
      }
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((span) => visit(span.expression))
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

describe('a translated screen’s words go through the layer (M60 U4, D-589)', () => {
  it('finds an inline word, and leaves a class list, a key and a code alone', () => {
    const source = [
      'export function A({ n }: { n: number }) {',
      '  if (event.key === "Enter") return null',
      '  const look = "flex items-center gap-1 text-ink"',
      '  return (',
      '    <div className="flex truncate" title="Open it" data-kind="PENDING">',
      '      Written',
      '      {n > 0 ? "newest" : t("home.x")}',
      '      <Figure label="Saved" tone="negative" />',
      '      {`${String(n)} rows`}',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    expect(inlineWords('a.tsx', source)).toEqual(['5: Open it', '6: Written', '7: newest', '8: Saved', '9: rows'])
  })

  it('leaves a key, a command, CSS and the product’s name alone (M60 F1)', () => {
    const source = [
      'export function B() {',
      '  const fill = `color-mix(in srgb, ${c} 45%, var(--color-background))`',
      '  const items = [{ label: t("x.delete"), shortcut: "Del" }]',
      '  return (',
      '    <p title="Emerald">',
      '      <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> <code>this week</code> <Key>Esc</Key>',
      '      <span className="sr-only"> rows</span>',
      '    </p>',
      '  )',
      '}',
    ].join('\n')
    expect(inlineWords('b.tsx', source)).toEqual(['7: rows'])
  })

  it.each(TRANSLATED)('%s has no inline word', (file) => {
    const found = inlineWords(file, readFileSync(file, 'utf8'))
    expect(found, `${file}:\n${found.join('\n')}\n`).toEqual([])
  })
})
