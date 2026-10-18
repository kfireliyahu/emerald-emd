import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { listAccounts, type Account } from '@/data/repositories/accountRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import {
  createRule,
  deleteRule,
  reorderRules,
  setRuleEnabled,
  updateRule,
} from '@/data/repositories/categoryRuleRepository.ts'
import {
  forkBuiltIn,
  loadRules,
  setBuiltInEnabled,
} from '@/data/repositories/ruleSetRepository.ts'
import { sortRules } from '@/domain/categorization.ts'
import {
  RULE_KINDS,
  RULE_ORIGINS,
  type CategoryRule,
  type RuleKind,
  type RuleOrigin,
} from '@/domain/model/rules.ts'
import {
  BLANK_DRAFT,
  asRule,
  draftOf,
  draftProblems,
  moveTo,
  neverFires,
  type RuleDraft,
} from '@/domain/ruleEditing.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { instantDay } from '@/core/instant.ts'
import { ReapplyPanel } from '@/ui/rules/ReapplyPanel.tsx'
import { RuleEditor } from '@/ui/rules/RuleEditor.tsx'
import { Flip } from '@/ui/motion/Flip.tsx'
import { TestBox } from '@/ui/rules/TestBox.tsx'
import { Why } from '@/ui/rules/Why.tsx'

/**
 * The rules, in the order the engine reads them, and the box that proves it.
 *
 * The list is sorted by `sortRules` rather than by anything this screen decides,
 * so what is shown top to bottom *is* the evaluation order — first match wins,
 * and the user can see which rule that will be without running an import. The
 * priorities underneath are integers, re-normalized in steps of ten every time
 * the order changes (D-037); nothing here shows a number, because the number is
 * not the thing the user is arranging.
 *
 * Until this screen existed a rule could only be created in code, so the engine
 * ran over an empty rule set on every real import. Everything else in F03 —
 * learning from corrections, re-apply, the built-in set — writes rules that end
 * up in this list, which is why this is the part that came first.
 *
 * The list is `loadRules`, not `listRules`: the built-ins the app ships are in
 * it, in their own tier at the bottom, and they behave differently in three
 * ways that all follow from their not being rows in the document (D-046). They
 * cannot be reordered — there is no priority to write. They cannot be deleted —
 * switching one off is a line in `app_setting`, and deleting something the app
 * would ship again next release is not a thing the user can mean. And editing
 * one **forks** it, which is F03's word: the copy is a normal rule of the
 * user's, and the original goes quiet underneath it.
 */
export function Rules() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  // A draft carried in from elsewhere — "create rule from this merchant" opens
  // this screen with one already filled in (D-041). Read once, on mount.
  const location = useLocation()
  const navigate = useNavigate()
  const arrived = arrivedDraft(location.state)

  const [editing, setEditing] = useState<Editing | undefined>(() =>
    arrived === undefined ? undefined : { mode: 'new', draft: arrived },
  )
  const [deleting, setDeleting] = useState<CategoryRule | undefined>()
  const [reapplying, setReapplying] = useState(false)
  const [dragging, setDragging] = useState<string | undefined>()
  const [over, setOver] = useState<string | undefined>()

  // Consumed once. Without this the draft comes back when the user navigates
  // away and presses Back, re-opening an editor they already dealt with.
  useEffect(() => {
    if (arrived !== undefined) navigate(location.pathname, { replace: true, state: null })
  }, [arrived, navigate, location.pathname])

  const data = useMemo(() => {
    if (db === undefined) return undefined

    // Archived categories come too, so a rule pointing at one is described
    // rather than reported as broken — archiving is not deleting.
    const categories = listCategories(db, { includeArchived: true })
    return {
      rules: sortRules(loadRules(db)),
      categories,
      pickable: categories.filter((category) => !category.isArchived),
      paths: new Map(categories.map((category) => [category.id, category.path])),
      accounts: listAccounts(db, { includeArchived: true }),
    }
  }, [db, revision])

  if (data === undefined) {
    return <Centered>Open a document, or create one, to write rules in it.</Centered>
  }

  const categoryPath = (categoryId: string): string | undefined => data.paths.get(categoryId)

  const save = (draft: RuleDraft): void => {
    if (draftProblems(draft).length > 0) return

    // One normalization, the same one the editor validated: a trimmed pattern,
    // dropped entirely for a kind that does not read one.
    const shaped = asRule(draft)
    const target = editing?.mode === 'edit' ? editing.rule : undefined
    const now = Date.now()

    mutate((database) => {
      const fields = {
        name: shaped.name,
        kind: shaped.kind,
        pattern: shaped.pattern,
        targetCategoryId: shaped.targetCategoryId,
        conditions: shaped.conditions,
      }
      if (target === undefined) createRule(database, fields, now)
      // F03: editing a built-in forks it. There is no row to update — the rule
      // ships with the app — so the edit becomes a rule of the user's own and
      // the built-in it came from is switched off, in one mutation.
      else if (target.origin === 'BUILT_IN') forkBuiltIn(database, target.id, fields, now)
      else updateRule(database, target.id, fields, now)
    })
    setEditing(undefined)
  }

  /**
   * Switch a rule off, wherever it is kept.
   *
   * A stored rule has an `is_enabled` column; a built-in has an id in a list in
   * `app_setting`. The screen asks for the same thing either way, which is the
   * point — the user is switching off a rule, not choosing a storage strategy.
   */
  const toggle = (rule: CategoryRule): void => {
    mutate((database) =>
      rule.origin === 'BUILT_IN'
        ? setBuiltInEnabled(database, rule.id, !rule.isEnabled, Date.now())
        : setRuleEnabled(database, rule.id, !rule.isEnabled, Date.now()),
    )
  }

  /**
   * Move a rule to a position within its own tier.
   *
   * Only its own tier: `reorderRules` renumbers exactly the ids it is given, and
   * a user rule dragged past a built-in would otherwise renumber a tier the user
   * was not looking at. The tiers cannot interleave anyway — origin outranks
   * priority in the comparator.
   */
  const move = (rule: CategoryRule, index: number): void => {
    // A built-in has no row and therefore no priority to write. Its order within
    // its own tier is kind specificity, which is the engine's rule rather than a
    // preference (D-046) — the row offers no handle, and this is the guard for
    // anything that gets past that.
    if (rule.origin === 'BUILT_IN') return

    const tier = data.rules.filter((other) => other.origin === rule.origin).map((other) => other.id)
    const next = moveTo(tier, rule.id, index)
    if (next === tier) return
    mutate((database) => reorderRules(database, next, Date.now()))
  }

  const tiers = RULE_ORIGINS.map(
    (origin) => [origin, data.rules.filter((rule) => rule.origin === origin)] as const,
  ).filter(([, rules]) => rules.length > 0)

  // "N rules" has always meant the user's, and it still does. The built-ins are
  // counted beside it rather than folded into it: a document with three rules in
  // it and a hundred shipped with the app does not have a hundred and three
  // rules, and a number that grows on its own between releases is a number
  // nobody can act on.
  const ownCount = data.rules.filter((rule) => rule.origin !== 'BUILT_IN').length
  const builtInCount = data.rules.length - ownCount

  const now = Date.now()

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2">
        <span className="text-ink-secondary tabular-nums">
          {ownCount === 1 ? '1 rule' : `${ownCount} rules`}
          {builtInCount > 0 && (
            <span className="text-ink-tertiary"> · {builtInCount} built in</span>
          )}
        </span>
        <span className="text-caption text-ink-tertiary">
          Read top to bottom on every import; the first rule that matches assigns the category and
          the rest are not consulted. A category you pick by hand always wins.
          {ownCount === 0 &&
            builtInCount > 0 &&
            ' None of these are yours yet — the built-in set is read last, so anything you write comes out above it.'}
        </span>
        {/* Editing a rule raises "and what about everything already imported?",
            so the answer to it lives on this screen rather than somewhere the
            user would have to know to look (F03). */}
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => setReapplying((open) => !open)}
          disabled={data.rules.length === 0}
          title={
            data.rules.length === 0
              ? 'Write a rule first — there is nothing to apply'
              : 'Run these rules over transactions already in the ledger'
          }
        >
          Apply to existing…
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setEditing({ mode: 'new', draft: BLANK_DRAFT })}
          disabled={editing?.mode === 'new'}
        >
          New rule
        </Button>
      </div>

      {reapplying && (
        <ReapplyPanel
          accounts={data.accounts}
          categoryPath={categoryPath}
          onClose={() => setReapplying(false)}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 overflow-auto">
          {data.rules.length === 0 ? (
            <Centered>
              No rules yet. A rule says “this merchant is that category”, and every import from
              then on applies it before you see the rows — nothing is decided that you cannot
              overrule. Write one, then try it in the test box.
            </Centered>
          ) : (
            tiers.map(([origin, rules]) => (
              <section key={origin}>
                {(tiers.length > 1 || origin !== 'USER') && (
                  <h2 className="sticky top-0 z-10 border-b border-hairline bg-background/90 px-6 py-2 text-label text-ink-tertiary uppercase backdrop-blur">
                    {ORIGIN_LABEL[origin]}
                  </h2>
                )}
                {/* A rule made, deleted or moved up the order: the rules below
                    make or give back its room (M39, src/ui/motion/). */}
                <Flip as="ul" flipKey={rules.map((rule) => rule.id).join(',')}>
                  {rules.map((rule, index) => (
                    <Row
                      key={rule.id}
                      rule={rule}
                      accounts={data.accounts}
                      categoryName={categoryPath(rule.targetCategoryId)}
                      // Never for a built-in: `neverFires` reads `hitCount` and
                      // `createdAt`, and a rule that arrived with the app has
                      // neither — it would be flagged as stale on the day it
                      // shipped (D-046).
                      quiet={rule.origin !== 'BUILT_IN' && neverFires(rule, now)}
                      isFirst={index === 0}
                      isLast={index === rules.length - 1}
                      dropEdge={
                        over === rule.id && dragging !== undefined && dragging !== rule.id
                          ? rules.findIndex((other) => other.id === dragging) < index
                            ? 'bottom'
                            : 'top'
                          : undefined
                      }
                      onDragStart={() => setDragging(rule.id)}
                      onDragOver={() => setOver(rule.id)}
                      onDrop={() => {
                        const dragged = rules.find((other) => other.id === dragging)
                        setDragging(undefined)
                        setOver(undefined)
                        if (dragged !== undefined) move(dragged, index)
                      }}
                      onDragEnd={() => {
                        setDragging(undefined)
                        setOver(undefined)
                      }}
                      onMove={(direction) => move(rule, index + direction)}
                      onEdit={() => setEditing({ mode: 'edit', rule })}
                      onToggle={() => toggle(rule)}
                      onDelete={() => setDeleting(rule)}
                    />
                  ))}
                </Flip>
              </section>
            ))
          )}
        </div>

        {data.rules.length > 0 && (
          <TestBox rules={data.rules} categoryPath={categoryPath} accounts={data.accounts} />
        )}
      </div>

      {editing !== undefined && (
        <RuleEditor
          key={editing.mode === 'new' ? 'new' : editing.rule.id}
          initial={editing.mode === 'new' ? editing.draft : draftOf(editing.rule)}
          // A fork is an addition, whatever it was opened from: the button says
          // what will happen, and what will happen is a new rule of the user's.
          isNew={editing.mode === 'new' || editing.rule.origin === 'BUILT_IN'}
          note={
            editing.mode === 'edit' && editing.rule.origin === 'BUILT_IN'
              ? 'Built-in rules ship with the app, so this saves your own copy of it — above every built-in, and yours to change from now on. The original is switched off so only one of them answers.'
              : undefined
          }
          categories={data.pickable}
          accounts={data.accounts}
          onSave={save}
          onCancel={() => setEditing(undefined)}
        />
      )}

      {deleting !== undefined && (
        <DeletePanel
          rule={deleting}
          onCancel={() => setDeleting(undefined)}
          onDelete={() => {
            const id = deleting.id
            setDeleting(undefined)
            setEditing((current) =>
              current?.mode === 'edit' && current.rule.id === id ? undefined : current,
            )
            mutate((database) => deleteRule(database, id, Date.now()))
          }}
        />
      )}
    </div>
  )
}

/**
 * What the editor is open on. A union rather than three loose flags: "writing a
 * new one", "writing a pre-filled one" and "changing an existing one" differ in
 * what they save to, and a boolean pair would let them be both.
 */
type Editing = { mode: 'new'; draft: RuleDraft } | { mode: 'edit'; rule: CategoryRule }

/**
 * A draft handed over through router state, checked rather than trusted.
 *
 * `location.state` is whatever was in the history entry — including something a
 * previous build of the app put there, in a document-based app people keep tabs
 * open in for weeks. Anything that is not the shape a draft has is ignored, and
 * the screen opens empty as though nothing was passed.
 */
function arrivedDraft(state: unknown): RuleDraft | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const draft = (state as { draft?: unknown }).draft
  if (typeof draft !== 'object' || draft === null) return undefined

  const { kind, pattern, targetCategoryId } = draft as Partial<RuleDraft>
  if (typeof pattern !== 'string' || typeof targetCategoryId !== 'string') return undefined
  if (!RULE_KINDS.includes(kind as RuleKind)) return undefined

  return { ...BLANK_DRAFT, ...(draft as RuleDraft) }
}

/**
 * The tiers, named as the user would describe them rather than as the enum
 * spells them.
 *
 * Shown when there is more than one, and also when the only one is not the
 * user's own. A list of rules the app wrote from corrections has to say so even
 * when there is nothing to contrast it with: "the app added this because you
 * corrected the same shop three times" is the whole of F03's fifth commitment,
 * and an unlabelled list reads as rules the user wrote and forgot.
 */
const ORIGIN_LABEL: Readonly<Record<RuleOrigin, string>> = {
  USER: 'Yours',
  // Not "learned". The app learned nothing — the user pressed a button and a
  // rule was written, and a heading that claims otherwise oversells a mapping
  // as intelligence (D-043). What the tier actually records is where the rule
  // came from, which is worth saying plainly and no more.
  LEARNED_FROM_CORRECTION: 'From your corrections',
  // Was "Suggested, not yet confirmed", which described a rule parked waiting
  // for someone to approve it. Nothing was ever parked, and since D-092 the
  // plugin writes these **enabled** — so the heading sat above rules that had
  // already fired a dozen times and said they had not been confirmed. The tier
  // records where a rule came from and nothing else, exactly as the two above
  // it do (D-099).
  AI_SUGGESTED: 'From a conversation with Claude',
  BUILT_IN: 'Built in',
}

function Row({
  rule,
  accounts,
  categoryName,
  quiet,
  isFirst,
  isLast,
  dropEdge,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: CategoryRule
  accounts: readonly Account[]
  categoryName: string | undefined
  quiet: boolean
  isFirst: boolean
  isLast: boolean
  dropEdge: 'top' | 'bottom' | undefined
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onMove: (direction: -1 | 1) => void
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  // A built-in has no row in the document, and three of a row's five actions
  // only mean something for one that does (D-046).
  const shipped = rule.origin === 'BUILT_IN'

  return (
    <li
      data-motion-key={rule.id}
      draggable={!shipped}
      onDragStart={onDragStart}
      // Without preventDefault the drop never fires — the browser's default for
      // a dragover is "not a drop target".
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      className={`group border-b border-hairline px-6 py-3 transition-colors duration-[var(--duration-micro)] hover:bg-surface ${
        dropEdge === 'top' ? 'border-t-2 border-t-ink' : ''
      } ${dropEdge === 'bottom' ? 'border-b-2 border-b-ink' : ''} ${
        rule.isEnabled ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center gap-x-3">
        {shipped ? (
          <span aria-hidden className="text-ink-tertiary select-none opacity-30">
            ⠿
          </span>
        ) : (
          <span aria-hidden className="cursor-grab text-ink-tertiary select-none" title="Drag to reorder">
            ⠿
          </span>
        )}

        <button
          type="button"
          onClick={onEdit}
          title={shipped ? 'Edit a copy of this rule' : 'Edit this rule'}
          className="hover:underline"
        >
          <Bidi className="font-medium">{rule.name}</Bidi>
        </button>

        {!rule.isEnabled && categoryName !== undefined && <Chip>off</Chip>}
        {/* A built-in naming a category this document does not have is not
            broken — it is inert, and says which of the two it is. Nothing was
            deleted from under a rule the user wrote; the app shipped a rule for
            a taxonomy this document does not use. */}
        {categoryName === undefined && (
          <Chip problem>{shipped ? 'no such category here' : 'category was deleted'}</Chip>
        )}
        {quiet && rule.isEnabled && <Chip>never fired</Chip>}

        {/* Quiet until the row is hovered or something in it has focus, and kept
            in the DOM so keyboard focus still reaches them. The arrows are the
            keyboard's way to do what dragging does. */}
        <span className="ml-auto flex items-center gap-x-3 text-caption text-ink-secondary opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 focus-within:opacity-100">
          {!shipped && (
            <>
              <IconButton onClick={() => onMove(-1)} label={`Move ${rule.name} up`} disabled={isFirst}>
                ↑
              </IconButton>
              <IconButton onClick={() => onMove(1)} label={`Move ${rule.name} down`} disabled={isLast}>
                ↓
              </IconButton>
            </>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="hover:text-ink"
            title={
              shipped
                ? 'Built-in rules ship with the app. Editing one saves your own copy above it and switches this one off.'
                : undefined
            }
          >
            {shipped ? 'Edit a copy' : 'Edit'}
          </button>
          {/* A built-in whose category is not in this document cannot be
              switched on to any effect, so it is not offered — editing it is the
              repair, and the copy that comes out points somewhere real. */}
          {(!shipped || categoryName !== undefined) && (
            <button type="button" onClick={onToggle} className="hover:text-ink">
              {rule.isEnabled ? 'Disable' : 'Enable'}
            </button>
          )}
          {!shipped && (
            <button type="button" onClick={onDelete} className="hover:text-negative">
              Delete
            </button>
          )}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption">
        <span className="text-ink-tertiary">
          <Why rule={rule} accounts={accounts} />
          {' → '}
          <span className={categoryName === undefined ? 'text-negative' : 'text-ink-secondary'}>
            {categoryName ?? 'a category that was deleted'}
          </span>
        </span>
        <span className="ml-auto whitespace-nowrap text-ink-tertiary tabular-nums">
          {hits(rule)}
        </span>
      </div>
    </li>
  )
}

/**
 * Deleting a rule costs nothing already imported, and the panel says so rather
 * than warning — the categories it assigned are on the transactions, and the
 * provenance keeps naming it.
 */
function DeletePanel({
  rule,
  onCancel,
  onDelete,
}: {
  rule: CategoryRule
  onCancel: () => void
  onDelete: () => void
}) {
  return (
    <div className="fc-pop-enter shrink-0 border-t border-hairline bg-surface px-6 py-4">
      <p>
        Delete <Bidi className="font-medium">{rule.name}</Bidi>. Later imports stop consulting it,
        and whatever it would have matched falls through to the rule below.
      </p>
      <p className="mt-1 text-ink-secondary">
        Nothing already imported changes: the transactions it categorized keep their categories.
        {rule.hitCount > 0 && ' To stop it firing without losing it, disable it instead.'}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onDelete}>
          Delete rule
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * How much work the rule has done. Never having done any is worth saying out
 * loud.
 *
 * Hit counts are per-document and live on the row (D-037). A built-in has no
 * row, so it has nowhere to keep one — and "never fired" under every rule the
 * app ships would be a claim about the user's spending that the app has not
 * checked. Saying nothing is the honest option; the test box answers the same
 * question for any merchant the user can name, which is the question they
 * actually have (D-046).
 */
function hits(rule: CategoryRule): string {
  if (rule.origin === 'BUILT_IN') return ''
  if (rule.hitCount === 0) return 'never fired'
  const times = rule.hitCount === 1 ? 'once' : `${rule.hitCount} times`
  return rule.lastMatchedAt === undefined
    ? `fired ${times}`
    : `fired ${times} · last ${instantDay(rule.lastMatchedAt)}`
}

function IconButton({
  children,
  onClick,
  label,
  disabled,
}: {
  children: string
  onClick: () => void
  label: string
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
