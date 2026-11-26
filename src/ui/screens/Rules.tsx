import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { instantDay } from '@/core/instant.ts'
import { zero } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { listAccounts } from '@/data/repositories/accountRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import {
  createRule,
  deleteRule,
  reorderRules,
  setRuleEnabled,
  updateRule,
} from '@/data/repositories/categoryRuleRepository.ts'
import { forkBuiltIn, loadRules, setBuiltInEnabled } from '@/data/repositories/ruleSetRepository.ts'
import { explain, matches, sortRules } from '@/domain/categorization.ts'
import { RULE_KINDS, RULE_ORIGINS, type CategoryRule, type RuleKind, type RuleOrigin } from '@/domain/model/rules.ts'
import { BLANK_DRAFT, asRule, draftOf, draftProblems, moveTo, neverFires, type RuleDraft } from '@/domain/ruleEditing.ts'
import type { MessageKey } from '@/i18n/catalogue.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { pathArrows } from '@/i18n/words.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { ContextMenu, isMenuKey, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState } from '@/ui/components/WaitingList.tsx'
import { Flip } from '@/ui/motion/Flip.tsx'
import { ReapplyPanel } from '@/ui/rules/ReapplyPanel.tsx'
import { RuleEditor } from '@/ui/rules/RuleEditor.tsx'
import { TestBox } from '@/ui/rules/TestBox.tsx'
import { Why } from '@/ui/rules/Why.tsx'

/** What the side panel holds: a rule's form, the built-in rules, the full test, or re-applying. */
type Panel =
  | { readonly kind: 'new'; readonly draft: RuleDraft }
  | { readonly kind: 'edit'; readonly rule: CategoryRule }
  | { readonly kind: 'builtIn' }
  | { readonly kind: 'test' }
  | { readonly kind: 'reapply' }

/** How long a delete's Undo stays where the rule was. */
const UNDO_MS = 8000

/**
 * **Rules** — the report (M64 U11, D-623). One question: *which shop goes to
 * which category, automatically?*
 *
 * **It answers first, in words**: how many rules are the person's, that they
 * are read top to bottom and the first that matches wins, and how many more
 * come with the app. The search under it is also the test box's first field:
 * type a shop and the answer comes as a sentence — which category, by which
 * rule — while the list narrows to the rules that mention it. Then the
 * person's rules as one table, in the order the engine reads them
 * (`sortRules`), each row one menu (*A row's menu is one menu*), never five
 * buttons.
 *
 * **Where each thing opens (D-617)**: a rule opens its form in the side panel,
 * and so does New rule; the built-in rules are behind their count, in the
 * panel, since they are the app's and rarely edited; the whole test box (an
 * amount, a provider category, an account) and re-applying to rows already
 * read are the panel's too. **Deleting deletes at once**, and Undo stays where
 * the rule was for a few seconds (Ctrl+Z too): a deleted rule comes back at
 * its place in the order, its count starting over.
 *
 * Built-ins behave differently in three ways that follow from their not being
 * the person's rows (D-046): they cannot be reordered or deleted, and editing
 * one **forks** it — the copy is the person's and the original goes quiet.
 */
export function Rules() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const t = useT()

  // A draft carried in from elsewhere — "create rule from this merchant" opens
  // this screen with one already filled in (D-041). Read once, on mount.
  const location = useLocation()
  const navigate = useNavigate()
  const arrived = arrivedDraft(location.state)

  const [panel, setPanel] = useState<Panel | undefined>(() =>
    arrived === undefined ? undefined : { kind: 'new', draft: arrived },
  )
  const [search, setSearch] = useState('')
  const [deleted, setDeleted] = useState<CategoryRule | undefined>()
  const [menu, setMenu] = useState<{ readonly rule: CategoryRule; readonly at: { readonly x: number; readonly y: number } } | undefined>()
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
      pickable: categories.filter((category) => !category.isArchived),
      paths: new Map(categories.map((category) => [category.id, category.path])),
      accounts: listAccounts(db, { includeArchived: true }),
    }
  }, [db, revision])

  // The note fades after a few seconds; Ctrl+Z undoes while it is there.
  const undoRef = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (deleted === undefined) return
    const timer = window.setTimeout(() => setDeleted(undefined), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [deleted])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') !== null) return
      if (undoRef.current === undefined) return
      event.preventDefault()
      undoRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (data === undefined) {
    return <Centered>{t('rules.noDocument')}</Centered>
  }

  // A path drawn the way its words run (M60 U5): a Hebrew one's arrows point left.
  const categoryPath = (categoryId: string): string | undefined => {
    const path = data.paths.get(categoryId)
    return path === undefined ? undefined : pathArrows(path)
  }

  const editing = panel?.kind === 'edit' ? panel.rule : undefined
  const save = (draft: RuleDraft): void => {
    if (draftProblems(draft).length > 0) return
    // One normalization, the same one the editor validated.
    const shaped = asRule(draft)
    const now = Date.now()
    mutate((database) => {
      const fields = {
        name: shaped.name,
        kind: shaped.kind,
        pattern: shaped.pattern,
        targetCategoryId: shaped.targetCategoryId,
        conditions: shaped.conditions,
      }
      if (editing === undefined) createRule(database, fields, now)
      // F03: editing a built-in forks it — the edit becomes a rule of the
      // person's own and the built-in it came from is switched off, in one write.
      else if (editing.origin === 'BUILT_IN') forkBuiltIn(database, editing.id, fields, now)
      else updateRule(database, editing.id, fields, now)
    })
    setDeleted(undefined)
    setPanel(undefined)
  }

  /** Switch a rule off, wherever it is kept: a stored rule's column, a built-in's line in the settings. */
  const toggle = (rule: CategoryRule): void => {
    setDeleted(undefined)
    mutate((database) =>
      rule.origin === 'BUILT_IN'
        ? setBuiltInEnabled(database, rule.id, !rule.isEnabled, Date.now())
        : setRuleEnabled(database, rule.id, !rule.isEnabled, Date.now()),
    )
  }

  /** Move a rule within its own tier: a built-in has no priority to write (D-046). */
  const move = (rule: CategoryRule, index: number): void => {
    if (rule.origin === 'BUILT_IN') return
    const tier = data.rules.filter((other) => other.origin === rule.origin).map((other) => other.id)
    const next = moveTo(tier, rule.id, index)
    if (next === tier) return
    setDeleted(undefined)
    mutate((database) => reorderRules(database, next, Date.now()))
  }

  /** Deletes at once, and keeps the rule for its Undo — never a question first (D-617). */
  const remove = (rule: CategoryRule): void => {
    if (rule.origin === 'BUILT_IN') return
    if (panel?.kind === 'edit' && panel.rule.id === rule.id) setPanel(undefined)
    mutate((database) => deleteRule(database, rule.id, Date.now()))
    setDeleted(rule)
  }
  /** Puts it back where it was in the order; what it filed before keeps its category either way. */
  const undo = (): void => {
    if (deleted === undefined) return
    const back = deleted
    setDeleted(undefined)
    mutate((database) =>
      createRule(
        database,
        {
          name: back.name,
          kind: back.kind,
          pattern: back.pattern,
          targetCategoryId: back.targetCategoryId,
          origin: back.origin,
          conditions: back.conditions,
          priority: back.priority,
          isEnabled: back.isEnabled,
        },
        Date.now(),
      ),
    )
  }
  undoRef.current = deleted === undefined ? undefined : undo

  const own = data.rules.filter((rule) => rule.origin !== 'BUILT_IN')
  const builtIns = data.rules.filter((rule) => rule.origin === 'BUILT_IN')

  // The search is the test box's first field: a shop, read the way an import reads it.
  const query = search.trim()
  const subject =
    query === ''
      ? undefined
      : { merchantNormalized: normalizeMerchant(query), providerCategory: undefined, amount: zero('ILS'), accountId: '' }
  const verdict = subject === undefined ? undefined : explain(data.rules, subject).winner
  const folded = query.toLocaleLowerCase()
  const shown =
    subject === undefined
      ? own
      : own.filter(
          (rule) =>
            matches({ ...rule, isEnabled: true }, subject) ||
            rule.name.toLocaleLowerCase().includes(folded) ||
            rule.pattern.toLocaleLowerCase().includes(folded) ||
            (data.paths.get(rule.targetCategoryId) ?? '').toLocaleLowerCase().includes(folded),
        )
  const tiers = RULE_ORIGINS.filter((origin) => origin !== 'BUILT_IN')
    .map((origin) => [origin, shown.filter((rule) => rule.origin === origin)] as const)
    .filter(([origin, rules]) => rules.length > 0 || deleted?.origin === origin)
  const now = Date.now()

  const menuItems = (rule: CategoryRule): readonly MenuItem[] => {
    const shipped = rule.origin === 'BUILT_IN'
    const tier = data.rules.filter((other) => other.origin === rule.origin)
    const at = tier.findIndex((other) => other.id === rule.id)
    const items: MenuItem[] = [
      { icon: 'edit', label: shipped ? t('rules.menu.editCopy') : t('rules.menu.edit'), shortcut: 'Enter', onChoose: () => setPanel({ kind: 'edit', rule }) },
    ]
    if (!shipped) {
      items.push(
        { icon: 'arrow', label: t('rules.menu.moveUp'), shortcut: 'Alt+↑', disabled: at <= 0, separated: true, onChoose: () => move(rule, at - 1) },
        { icon: 'arrow', label: t('rules.menu.moveDown'), shortcut: 'Alt+↓', disabled: at >= tier.length - 1, onChoose: () => move(rule, at + 1) },
      )
    }
    // A built-in whose category is not in this document cannot be switched on
    // to any effect: editing it is the repair.
    if (!shipped || categoryPath(rule.targetCategoryId) !== undefined) {
      items.push({
        label: rule.isEnabled ? t('rules.menu.turnOff') : t('rules.menu.turnOn'),
        separated: true,
        onChoose: () => toggle(rule),
      })
    }
    if (!shipped) items.push({ icon: 'trash', label: t('rules.menu.delete'), shortcut: 'Del', onChoose: () => remove(rule) })
    return items
  }

  /** The list's keys, as everywhere: arrows walk, Enter opens, Delete deletes, Alt+arrows move, the menu key opens the menu. */
  const rowKeys = (rule: CategoryRule, index: number, event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return
    if (isMenuKey(event)) {
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      setMenu({ rule, at: { x: box.left + 160, y: box.bottom } })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      setPanel({ kind: 'edit', rule })
    } else if (event.key === 'Delete' && rule.origin !== 'BUILT_IN') {
      event.preventDefault()
      const rows = rowsAround(event.currentTarget)
      const at = rows.indexOf(event.currentTarget)
      remove(rule)
      // Focus stays in the list, on the row that takes its place.
      window.requestAnimationFrame(() => (rows[at + 1] ?? rows[at - 1])?.focus())
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (event.altKey) {
        move(rule, index + (event.key === 'ArrowDown' ? 1 : -1))
        return
      }
      const rows = rowsAround(event.currentTarget)
      const at = rows.indexOf(event.currentTarget)
      rows[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
    }
  }

  const row = (rule: CategoryRule, index: number, rules: readonly CategoryRule[]) => {
    const shipped = rule.origin === 'BUILT_IN'
    const category = categoryPath(rule.targetCategoryId)
    const dropEdge =
      over === rule.id && dragging !== undefined && dragging !== rule.id
        ? rules.findIndex((other) => other.id === dragging) < index
          ? 'border-b-2 border-b-ink'
          : 'border-t-2 border-t-ink'
        : ''
    return (
      <li
        key={rule.id}
        data-motion-key={rule.id}
        data-rule-row
        tabIndex={0}
        draggable={!shipped}
        onClick={() => setPanel({ kind: 'edit', rule })}
        onKeyDown={(event) => rowKeys(rule, index, event)}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ rule, at: { x: event.clientX, y: event.clientY } })
        }}
        onDragStart={() => setDragging(rule.id)}
        // Without preventDefault the drop never fires.
        onDragOver={(event) => {
          event.preventDefault()
          setOver(rule.id)
        }}
        onDrop={(event) => {
          event.preventDefault()
          const dragged = rules.find((other) => other.id === dragging)
          setDragging(undefined)
          setOver(undefined)
          if (dragged !== undefined) move(dragged, index)
        }}
        onDragEnd={() => {
          setDragging(undefined)
          setOver(undefined)
        }}
        aria-current={editing?.id === rule.id ? 'true' : undefined}
        className={`${GRID} group h-10 cursor-pointer border-b border-hairline outline-none transition-colors duration-[var(--duration-micro)] hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
          editing?.id === rule.id ? 'bg-accent-soft' : ''
        } ${dropEdge}`}
      >
        <span
          aria-hidden
          className={`flex text-ink-secondary opacity-0 transition-opacity duration-[var(--duration-micro)] ${shipped ? '' : 'cursor-grab group-hover:opacity-100 group-focus-within:opacity-100'}`}
          title={shipped ? undefined : t('rules.row.drag')}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" className="fill-current">
            <circle cx="6" cy="4" r="1.25" />
            <circle cx="10" cy="4" r="1.25" />
            <circle cx="6" cy="8" r="1.25" />
            <circle cx="10" cy="8" r="1.25" />
            <circle cx="6" cy="12" r="1.25" />
            <circle cx="10" cy="12" r="1.25" />
          </svg>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <Bidi className={`min-w-0 truncate ${rule.isEnabled ? '' : 'text-ink-secondary'}`}>{rule.name}</Bidi>
          {!rule.isEnabled && category !== undefined && <Chip>{t('rules.row.off')}</Chip>}
          {!shipped && rule.isEnabled && neverFires(rule, now) && <Chip>{t('rules.row.neverFired')}</Chip>}
        </span>
        <span className="min-w-0 truncate text-ink-secondary">
          <Why rule={rule} accounts={data.accounts} />
        </span>
        <span className="flex min-w-0">
          {category === undefined ? (
            <Chip problem>{shipped ? t('rules.row.noSuchCategory') : t('rules.row.categoryDeleted')}</Chip>
          ) : (
            <Bidi className="min-w-0 truncate">{category}</Bidi>
          )}
        </span>
        <span className="text-end text-ink-secondary tabular-nums" title={fired(rule, t)}>
          {shipped ? '' : rule.hitCount === 0 ? t('rules.fired.never') : String(rule.hitCount)}
        </span>
        <span
          className="flex justify-end opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <IconAction
            label={t('rules.menu.more', { name: rule.name })}
            onClick={(event) => {
              const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
              setMenu({ rule, at: { x: box.right - 4, y: box.bottom + 2 } })
            }}
          >
            <circle cx="6" cy="12" r="1.25" />
            <circle cx="12" cy="12" r="1.25" />
            <circle cx="18" cy="12" r="1.25" />
          </IconAction>
        </span>
      </li>
    )
  }

  const page = (
    <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="m-0 text-title leading-tight font-medium">{t('rules.title')}</h1>
        <div className="flex flex-wrap items-center gap-3">
          {/* "And what about everything already read?" is answered here, not somewhere one would have to know of (F03). */}
          <Button
            variant="secondary"
            onClick={() => setPanel({ kind: 'reapply' })}
            disabled={data.rules.length === 0}
            title={data.rules.length === 0 ? t('rules.applyNothing') : t('rules.applyTitle')}
          >
            {t('rules.applyExisting')}
          </Button>
          <Button variant="primary" icon="add" onClick={() => setPanel({ kind: 'new', draft: BLANK_DRAFT })}>
            {t('rules.newRule')}
          </Button>
        </div>
      </header>

      <p className="m-0 max-w-[60ch] text-lede [text-wrap:balance]">
        {own.length === 0 ? t('rules.answerNone') : t(countKey('rules.answer', own.length), { count: own.length })}
      </p>
      <p className="m-0 -mt-3 flex max-w-[72ch] flex-wrap items-baseline gap-x-3 text-ink-secondary">
        <span>{t('rules.order')}</span>
        {builtIns.length > 0 && (
          <button type="button" className="fc-text-action" onClick={() => setPanel({ kind: 'builtIn' })}>
            {t(countKey('rules.builtInCount', builtIns.length), { count: builtIns.length })}
          </button>
        )}
      </p>

      <div className="flex flex-col gap-2 border-t border-hairline pt-6">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search !== '') {
              event.preventDefault()
              setSearch('')
            }
          }}
          placeholder={t('rules.find')}
          aria-label={t('rules.findLabel')}
          dir="auto"
          className={`${FIELD} w-full max-w-[28rem]`}
        />
        {subject !== undefined && (
          <p className="m-0 flex flex-wrap items-baseline gap-x-3" aria-live="polite">
            <span>
              {verdict === undefined ? (
                <Phrase text={t('rules.verdictNone')} parts={{ shop: <Bidi className="font-medium">{query}</Bidi> }} />
              ) : (
                <Phrase
                  text={t('rules.verdict')}
                  parts={{
                    shop: <Bidi className="font-medium">{query}</Bidi>,
                    category: <Bidi className="font-medium">{categoryPath(verdict.targetCategoryId) ?? t('rules.row.deletedCategory')}</Bidi>,
                    rule: <Bidi>{verdict.name}</Bidi>,
                  }}
                />
              )}
            </span>
            <button type="button" className="fc-text-action" onClick={() => setPanel({ kind: 'test' })}>
              {t('rules.testMore')}
            </button>
          </p>
        )}
      </div>

      {own.length === 0 && deleted === undefined ? (
        <EmptyState say={t('rules.empty')} verb={t('rules.newRule')} onDo={() => setPanel({ kind: 'new', draft: BLANK_DRAFT })} />
      ) : shown.length === 0 && deleted === undefined ? (
        <EmptyState say={t('rules.noneFound', { search: query })} />
      ) : (
        <div className="flex flex-col" data-block data-rule-list>
          <div className={`${GRID} h-8 border-b border-hairline text-caption text-ink-secondary`} aria-hidden>
            <span />
            <span>{t('rules.columns.rule')}</span>
            <span>{t('rules.columns.when')}</span>
            <span>{t('rules.columns.category')}</span>
            <span className="text-end">{t('rules.columns.fired')}</span>
            <span />
          </div>
          {tiers.map(([origin, rules]) => (
            <section key={origin} aria-label={t(ORIGIN_LABEL[origin])}>
              {(tiers.length > 1 || origin !== 'USER') && (
                <h2 className="m-0 flex h-8 items-end border-b border-hairline pb-1.5 text-label font-medium text-ink-secondary uppercase">
                  {t(ORIGIN_LABEL[origin])}
                </h2>
              )}
              {/* A rule made, deleted or moved: the rules below make or give back its room (M39). */}
              <Flip as="ul" className="m-0 list-none p-0" flipKey={rules.map((rule) => rule.id).join(',')}>
                {placeNote(rules, deleted, origin).map((item) =>
                  item !== 'note' ? (
                    row(item, rules.indexOf(item), rules)
                  ) : deleted === undefined ? null : (
                    <li key="deleted" data-motion-key="deleted" className="fc-pop-enter flex h-10 items-center gap-3 border-b border-hairline ps-8 text-ink-secondary">
                      <Phrase text={t('rules.deleted')} parts={{ name: <Bidi className="text-ink">{deleted.name}</Bidi> }} />
                      <button type="button" className="fc-text-action" onClick={undo} title={t('rules.undoTitle')}>
                        {t('rules.undo')}
                      </button>
                    </li>
                  ),
                )}
              </Flip>
            </section>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>

      {panel?.kind === 'new' || panel?.kind === 'edit' ? (
        <SidePanel
          kicker={panel.kind === 'edit' && panel.rule.origin === 'BUILT_IN' ? t('rules.origin.BUILT_IN') : undefined}
          title={panel.kind === 'new' ? t('rules.newRule') : <Bidi>{panel.rule.name}</Bidi>}
          onClose={() => setPanel(undefined)}
        >
          <RuleEditor
            key={panel.kind === 'new' ? 'new' : panel.rule.id}
            initial={panel.kind === 'new' ? panel.draft : draftOf(panel.rule)}
            // A fork is an addition, whatever it was opened from.
            isNew={panel.kind === 'new' || panel.rule.origin === 'BUILT_IN'}
            note={panel.kind === 'edit' && panel.rule.origin === 'BUILT_IN' ? t('rules.forkNote') : undefined}
            categories={data.pickable}
            accounts={data.accounts}
            onSave={save}
            onCancel={() => setPanel(undefined)}
          />
          {panel.kind === 'edit' && panel.rule.origin !== 'BUILT_IN' && (
            <p className="m-0 border-t border-hairline pt-3 text-ink-secondary">{fired(panel.rule, t)}</p>
          )}
        </SidePanel>
      ) : panel?.kind === 'builtIn' ? (
        <SidePanel title={t('rules.origin.BUILT_IN')} onClose={() => setPanel(undefined)}>
          <p className="m-0 text-ink-secondary">{t('rules.builtInLead')}</p>
          <ul className="m-0 list-none p-0" data-rule-list>
            {builtIns.map((rule, index) => {
              const category = categoryPath(rule.targetCategoryId)
              return (
                <li
                  key={rule.id}
                  data-rule-row
                  tabIndex={0}
                  onClick={() => setPanel({ kind: 'edit', rule })}
                  onKeyDown={(event) => rowKeys(rule, index, event)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({ rule, at: { x: event.clientX, y: event.clientY } })
                  }}
                  className="flex h-10 cursor-pointer items-center gap-3 border-b border-hairline outline-none hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <Bidi className={`min-w-0 flex-1 truncate ${rule.isEnabled ? '' : 'text-ink-secondary'}`}>{rule.name}</Bidi>
                  {!rule.isEnabled && category !== undefined && <Chip>{t('rules.row.off')}</Chip>}
                  {category === undefined ? (
                    <Chip problem>{t('rules.row.noSuchCategory')}</Chip>
                  ) : (
                    <Bidi className="max-w-[45%] truncate text-ink-secondary">{category}</Bidi>
                  )}
                </li>
              )
            })}
          </ul>
        </SidePanel>
      ) : panel?.kind === 'test' ? (
        <SidePanel title={t('rules.test.title')} onClose={() => setPanel(undefined)}>
          <TestBox rules={data.rules} categoryPath={categoryPath} accounts={data.accounts} merchant={query} />
        </SidePanel>
      ) : panel?.kind === 'reapply' ? (
        <SidePanel title={t('rules.reapply.title')} onClose={() => setPanel(undefined)}>
          <ReapplyPanel accounts={data.accounts} categoryPath={categoryPath} />
        </SidePanel>
      ) : null}

      {menu !== undefined && (
        <ContextMenu
          at={menu.at}
          items={menuItems(menu.rule)}
          onClose={() => setMenu(undefined)}
          header={{
            title: <Bidi>{menu.rule.name}</Bidi>,
            sub: <Bidi>{categoryPath(menu.rule.targetCategoryId) ?? t('rules.row.deletedCategory')}</Bidi>,
          }}
        />
      )}
    </div>
  )
}

/** Every row of the list a row is in, for the arrow keys. */
function rowsAround(row: HTMLElement): HTMLElement[] {
  return [...(row.closest('[data-rule-list]')?.querySelectorAll<HTMLElement>('[data-rule-row]') ?? [])]
}

/** The columns of the rules' table: the drag handle, the rule, when it matches, where it files, how often, its menu. */
const GRID = 'grid grid-cols-[1rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_4.5rem_2rem] items-center gap-x-3 px-2'

/** The rows of a tier with the deleted rule's note at the place it had in the order. */
function placeNote(
  rules: readonly CategoryRule[],
  deleted: CategoryRule | undefined,
  origin: RuleOrigin,
): readonly (CategoryRule | 'note')[] {
  if (deleted === undefined || deleted.origin !== origin) return rules
  const at = rules.findIndex((rule) => rule.priority > deleted.priority)
  return at === -1 ? [...rules, 'note'] : [...rules.slice(0, at), 'note', ...rules.slice(at)]
}

/**
 * How much work the rule has done, in a sentence. A built-in has no row to keep
 * a count on, and *never fired* under every rule the app ships would be a claim
 * the app has not checked, so it says nothing (D-046).
 */
function fired(rule: CategoryRule, t: ReturnType<typeof useT>): string {
  if (rule.origin === 'BUILT_IN') return ''
  if (rule.hitCount === 0) return t('rules.row.neverFired')
  const once = rule.hitCount === 1
  return rule.lastMatchedAt === undefined
    ? t(once ? 'rules.hits.once' : 'rules.hits.times', { n: rule.hitCount })
    : t(once ? 'rules.hits.onceLast' : 'rules.hits.timesLast', { n: rule.hitCount, day: instantDay(rule.lastMatchedAt) })
}

/**
 * A draft handed over through router state, checked rather than trusted: a
 * history entry can hold whatever an earlier build put there.
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
 * The tiers, named as a person would describe them: where a rule came from and
 * nothing else (D-043, D-099).
 */
const ORIGIN_LABEL: Readonly<Record<RuleOrigin, MessageKey>> = {
  USER: 'rules.origin.USER',
  LEARNED_FROM_CORRECTION: 'rules.origin.LEARNED_FROM_CORRECTION',
  AI_SUGGESTED: 'rules.origin.AI_SUGGESTED',
  BUILT_IN: 'rules.origin.BUILT_IN',
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
