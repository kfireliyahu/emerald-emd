import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatMoney, fromMajorUnits, money, type Money } from '@/core/money.ts'
import { addMonths, parseYearMonth, toYearMonthString, yearMonthOf } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import {
  categoryActivity,
  categoryDeleteTargets,
  categoryMerchants,
  categorySeries,
  categoryUsage,
  createCategory,
  deleteCategory,
  isCategoryInUse,
  listCategories,
  mergeCategories,
  moveCategory,
  renameCategory,
  reparentCategory,
  setCategoryAppearance,
  setCategoryArchived,
  type Category,
  type CategoryActivity,
  type CategoryKind,
  type CategoryUsage,
} from '@/data/repositories/categoryRepository.ts'
import { categoryBudgets, setCategoryBudget } from '@/data/repositories/categoryBudgetRepository.ts'
import { listSplitPlans } from '@/data/repositories/splitPlanRepository.ts'
import { today } from '@/ui/today.ts'
import { loadRules } from '@/data/repositories/ruleSetRepository.ts'
import { monthlyTotals } from '@/data/repositories/transactionRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { CATEGORY_COLOR_TOKENS } from '@/domain/categoryColors.ts'
import { isMovedKind } from '@/data/repositories/movedRepository.ts'
import type { MessageKey } from '@/i18n/catalogue.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { pathArrows } from '@/i18n/words.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { AppearancePicker } from '@/ui/categories/AppearancePicker.tsx'
import { AskAtButton } from '@/ui/categories/AskAtButton.tsx'
import { buildTaxonomy, type TaxonomySection } from '@/ui/categories/taxonomyView.ts'
import { token } from '@/ui/charts/categoryColor.ts'
import { type CategoryPalette } from '@/ui/charts/categoryPalette.ts'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { RankedBars } from '@/ui/charts/RankedBars.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { CategoryMark, useCategoryPalette } from '@/ui/components/CategoryMark.tsx'
import { ContextMenu, isMenuKey, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { WaitingList } from '@/ui/components/WaitingList.tsx'
import { Pager } from '@/ui/home/parts.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { ParentPicker } from '@/ui/categories/ParentPicker.tsx'
import { eligibleParents, parentsFor } from '@/ui/categories/parentFilter.ts'
import { Flip } from '@/ui/motion/Flip.tsx'

/** The three parts of the list, by what a category is: what you spend, what moved, what came in. */
type Part = 'SPENDING' | 'MOVED' | 'INCOME'

const PARTS: readonly Part[] = ['SPENDING', 'MOVED', 'INCOME']

// The same list the totals read (D-316): a category here is moved, not spent.
const partOf = (kind: CategoryKind): Part => (kind === 'INCOME' ? 'INCOME' : isMovedKind(kind) ? 'MOVED' : 'SPENDING')

/** A year of months, for the panel's trend. */
const YEAR = 12

/** How long an Undo stays where the thing happened. */
const UNDO_MS = 8000

/** What the panel asks first when it opens from the menu: a merge, a delete that moves rows, or where it sits. */
type Asking = 'merge' | 'delete' | 'under'

/** A thing just done that one press takes back: what is said, which group it happened in, and how. */
interface Undoable {
  readonly say: string
  readonly group: string | undefined
  readonly undo: () => void
}

/**
 * **Categories** — the report (M64 U11, D-623; the direction D-614, the
 * language D-615). One question: *what kinds of spending do I have, and what
 * is in each?*
 *
 * **It answers first, in words** — how many categories of spending there are
 * and how many held something in the month shown — and what waits on the
 * person (a starter set nobody uses) is one line below it. Then the tree:
 * spending, money moved and income as three parts of one list (one level of
 * tabs is the section's own, Categories and Rules), each group a heading with
 * its total and each category a dot, its name, the month's bar in its own
 * colour and its figure. **The unused are behind *n unused*** in each group.
 *
 * **Where each thing opens (D-617)**: a category opens beside the list
 * (`SidePanel`) with its year, its shops, its rules, its bucket, where it sits
 * and its colour; a rename is in place on the line (F2, or the menu); a colour
 * is the dot's popover; a new category is a form in the panel. Merge into… and
 * a delete of a category still in use move rows for good, so each asks at its
 * button in the panel, with the category the rows go to. **Deleting an unused
 * one, and archiving, happen at once** with Undo where it happened (Ctrl+Z
 * too). The row's menu (right-click, ⋯, Shift+F10) holds the rest.
 *
 * **Unchanged**: a system category cannot be renamed, moved or deleted, a
 * delete moves what uses a category first (M28 F18, D-340), and the refusals
 * read the same.
 */
export function Categories() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  const t = useT()
  const dates = useDates()

  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string | undefined>()
  const [asking, setAsking] = useState<Asking | undefined>()
  const [adding, setAdding] = useState(false)
  const [showUnused, setShowUnused] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<string | undefined>()
  const [problem, setProblem] = useState<React.ReactNode>()
  const [done, setDone] = useState<Undoable | undefined>()
  const [menu, setMenu] = useState<
    { readonly category: Category; readonly at: { readonly x: number; readonly y: number } } | undefined
  >()
  const [wanted, setWanted] = useState<string | undefined>()

  // One read, archived included: the palette resolves over the live ones only,
  // and the list shows what Show archived asks for.
  const all = useMemo(
    () => (db === undefined ? [] : listCategories(db, { includeArchived: true })),
    [db, revision],
  )
  const activity = useMemo(
    () => (db === undefined ? new Map<string, CategoryActivity>() : categoryActivity(db, '0000-01-01')),
    [db, revision],
  )
  const palette = useCategoryPalette(all)

  /** The months the document has rows in, newest first — what the pager walks. */
  const months = useMemo(
    () => (db === undefined ? [] : [...new Set(monthlyTotals(db).map((total) => total.period))]),
    [db, revision],
  )
  // It opens on the last finished month, as Home does (D-607): the month still running is mostly dashes.
  const running = toYearMonthString(yearMonthOf(today()))
  const opening = months[0] === running && months[1] !== undefined ? months[1] : months[0]
  const period = wanted !== undefined && months.includes(wanted) ? wanted : opening
  const currency = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])

  /** Twelve months ending at the one shown, for every category at once. */
  const series = useMemo(() => {
    if (db === undefined || period === undefined) return { out: new Map<string, readonly number[]>(), in: new Map<string, readonly number[]>() }
    return {
      out: categorySeries(db, period, YEAR, currency, 'OUT'),
      in: categorySeries(db, period, YEAR, currency, 'IN'),
    }
  }, [db, revision, period, currency])
  const seriesOf = (category: Category): readonly number[] | undefined =>
    (category.kind === 'INCOME' ? series.in : series.out).get(category.id)
  const monthOf = (category: Category): number => seriesOf(category)?.at(-1) ?? 0

  const rules = useMemo(() => (db === undefined ? [] : loadRules(db)), [db, revision])

  /** A category's budget is its Plan bucket (D-327): read from the plan in use, never stored here. */
  const budgets = useMemo(
    () => (db === undefined ? new Map<string, Money>() : categoryBudgets(db, today(), currency)),
    [db, revision, currency],
  )
  const hasPlan = useMemo(() => db !== undefined && listSplitPlans(db).length > 0, [db, revision])

  const visible = useMemo(
    () => (showArchived ? all : all.filter((category) => !category.isArchived)),
    [all, showArchived],
  )
  const parts = useMemo(
    () =>
      PARTS.map((part) => {
        const here = visible.filter((category) => partOf(category.kind) === part)
        return { part, here, sections: buildTaxonomy(here, { search, used: (id) => activity.has(id) }) }
      }),
    [visible, search, activity],
  )

  /**
   * **S4: the starter set, put away in one go.** A category nothing has ever
   * been filed under, that nothing points at and that holds no target. A
   * parent goes only when every child of it does too; archived is not deleted.
   */
  const unused = useMemo(() => {
    const live = all.filter((category) => !category.isArchived && !category.isSystem)
    const targeted = new Set(rules.filter((rule) => rule.origin !== 'BUILT_IN').map((rule) => rule.targetCategoryId))
    const free = (category: Category): boolean =>
      !activity.has(category.id) && !targeted.has(category.id) && !budgets.has(category.id)
    const kids = (id: string): Category[] => live.filter((category) => category.parentId === id)
    return live.filter((category) => free(category) && kids(category.id).every(free))
  }, [all, activity, rules, budgets])

  // The note fades after a few seconds; Ctrl+Z takes it back while it is there.
  const undoRef = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (done === undefined) return
    const timer = window.setTimeout(() => setDone(undefined), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [done])
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

  if (db === undefined) {
    return <Centered>{t('categories.noDocument')}</Centered>
  }

  const write = (work: (database: import('sql.js').Database, now: number) => void, keepUndo = false): void => {
    setProblem(undefined)
    // Undo is for the last thing done: any other write takes it away.
    if (!keepUndo) setDone(undefined)
    try {
      mutate((database) => work(database, Date.now()))
    } catch (error) {
      // A refusal is information, not a crash.
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }
  const undo = (): void => {
    if (done === undefined) return
    const back = done
    setDone(undefined)
    back.undo()
  }
  undoRef.current = done === undefined ? undefined : undo

  /** The group a category is drawn in: its top-level ancestor. */
  const groupOf = (category: Category): string | undefined => {
    let at: Category | undefined = category
    while (at?.parentId !== undefined) at = all.find((one) => one.id === at?.parentId)
    return at?.id
  }

  /** What still uses a category, in words — `describeCategoryUsage`'s, in the language now. */
  const usageWords = (usage: CategoryUsage): string => {
    const some = (n: number, one: MessageKey, many: MessageKey): string | undefined =>
      n === 0 ? undefined : n === 1 ? t(one) : t(many, { n: String(n) })
    const parts = [
      some(usage.transactions, 'categories.usage.row', 'categories.usage.rows'),
      some(usage.rules, 'categories.usage.rule', 'categories.usage.rules'),
      some(usage.subcategories, 'categories.usage.subcategory', 'categories.usage.subcategories'),
      some(usage.budgets, 'categories.usage.bucket', 'categories.usage.buckets'),
      some(usage.fixedExpenses, 'categories.usage.bill', 'categories.usage.bills'),
      some(usage.debts, 'categories.usage.debt', 'categories.usage.debts'),
      some(usage.goals, 'categories.usage.goal', 'categories.usage.goals'),
    ].filter((part): part is string => part !== undefined)
    if (parts.length === 0) return t('categories.usage.nothing')
    if (parts.length === 1) return parts[0] ?? ''
    return t('categories.usage.last', { rest: parts.slice(0, -1).join(', '), last: parts.at(-1) ?? '' })
  }

  const open = (category: Category, ask?: Asking): void => {
    setAdding(false)
    setPicked(category.id)
    setAsking(ask)
  }

  /**
   * **Delete, the chosen way** (M28 F18, D-340; D-617): nothing uses it, it
   * goes at once, with Undo; something does, and the panel asks at its Delete
   * where all of it moves; nowhere of its kind to move it, and it is refused by
   * what still uses it.
   */
  const remove = (category: Category): void => {
    setProblem(undefined)
    if (category.isSystem) return
    const usage = categoryUsage(db, category.id)
    if (!isCategoryInUse(usage)) {
      const { name, kind, parentId, color, icon } = category
      write((database, now) => deleteCategory(database, category.id, now))
      if (picked === category.id) setPicked(undefined)
      setDone({
        say: t('categories.deleted', { name }),
        group: parentId === undefined ? undefined : groupOf(category),
        undo: () =>
          write((database, now) => {
            const id = createCategory(database, { name, kind, parentId }, now)
            if (color !== undefined || icon !== undefined) setCategoryAppearance(database, id, { color, icon }, now)
          }),
      })
      return
    }
    if (categoryDeleteTargets(db, category.id).length === 0) {
      setProblem(
        <Phrase
          text={t(usage.subcategories > 0 ? 'categories.noTargetRoom' : 'categories.noTarget', {
            using: usageWords(usage),
            tab: t(`categories.tabsInline.${partOf(category.kind)}`),
          })}
          parts={{ name: <Bidi>{category.name}</Bidi> }}
        />,
      )
      return
    }
    open(category, 'delete')
  }

  /** Archiving puts it away and keeps every row it has, so it happens at once and Undo brings it back. */
  const archive = (category: Category): void => {
    const restoring = category.isArchived
    write((database, now) => setCategoryArchived(database, category.id, !restoring, now))
    if (restoring) return
    setDone({
      say: t('categories.archived', { name: category.name }),
      group: category.parentId === undefined ? undefined : groupOf(category),
      undo: () => write((database, now) => setCategoryArchived(database, category.id, false, now)),
    })
  }

  // What a new category can go under: anything with room below it, three levels deep (M28 F29).
  const parents = eligibleParents(all)
  const liveOwn = all.filter((category) => !category.isArchived && !category.isSystem)
  const crowded = unused.length >= 5 && unused.length * 2 >= liveOwn.length

  const searching = search.trim() !== ''
  const selected = picked === undefined ? undefined : all.find((category) => category.id === picked)

  const menuItems = (category: Category): readonly MenuItem[] => {
    const mine = rules.filter((rule) => rule.targetCategoryId === category.id && rule.origin !== 'BUILT_IN')
    const homes = parentsFor(all, category).filter((one) => one.id !== category.parentId)
    const items: MenuItem[] = [{ icon: 'right', label: t('categories.menu.open'), shortcut: 'Enter', onChoose: () => open(category) }]
    if (!category.isSystem) {
      items.push({ icon: 'edit', label: t('categories.menu.rename'), shortcut: 'F2', onChoose: () => setEditing(category.id) })
    }
    if (!category.isSystem) {
      items.push(
        {
          icon: 'move',
          label: t('categories.menu.moveUnder'),
          disabled: homes.length === 0 && category.parentId === undefined,
          detail: homes.length === 0 && category.parentId === undefined ? t('categories.menu.moveUnderFull') : undefined,
          onChoose: () => open(category, 'under'),
        },
        {
          icon: 'merge',
          label: t('categories.menu.mergeInto'),
          detail: t('categories.menu.mergeDetail'),
          onChoose: () => open(category, 'merge'),
        },
      )
    }
    items.push(
      { icon: 'arrow', label: t('categories.menu.moveUp'), separated: true, onChoose: () => write((d, now) => moveCategory(d, category.id, -1, now)) },
      { icon: 'arrow', label: t('categories.menu.moveDown'), onChoose: () => write((d, now) => moveCategory(d, category.id, 1, now)) },
      {
        icon: 'filter',
        label: t('categories.menu.showRows'),
        separated: true,
        onChoose: () =>
          navigate('/transactions', { state: { category: category.id, ...(period === undefined ? {} : { period }) } }),
      },
      {
        icon: 'rule',
        label: t('categories.menu.itsRules'),
        detail: mine.length === 0 ? t('categories.menu.noRulesYet') : t('categories.menu.yours', { n: mine.length }),
        onChoose: () => navigate('/categories/rules'),
      },
    )
    if (!category.isSystem) {
      const inUse = isCategoryInUse(categoryUsage(db, category.id))
      items.push(
        {
          icon: 'archive',
          label: category.isArchived ? t('categories.restore') : t('categories.archive'),
          detail: category.isArchived ? undefined : t('categories.menu.archiveDetail'),
          separated: true,
          onChoose: () => archive(category),
        },
        {
          icon: 'trash',
          label: t('categories.menu.delete'),
          shortcut: 'Del',
          detail: inUse ? t('categories.menu.deleteDetail') : undefined,
          onChoose: () => remove(category),
        },
      )
    }
    return items
  }

  /** The list's keys, as everywhere: arrows walk, Enter opens, F2 renames, Delete deletes, the menu key opens the menu. */
  const rowKeys = (category: Category, event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return
    if (isMenuKey(event)) {
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      setMenu({ category, at: { x: box.left + 160, y: box.bottom } })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      open(category)
    } else if (event.key === 'F2' && !category.isSystem) {
      event.preventDefault()
      setEditing(category.id)
    } else if (event.key === 'Delete' && !category.isSystem) {
      event.preventDefault()
      remove(category)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const rows = [...document.querySelectorAll<HTMLElement>('[data-category-row]')]
      const at = rows.indexOf(event.currentTarget)
      rows[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
    }
  }

  const rowFor = (category: Category, level: Level, figure: number, top: number, extra?: React.ReactNode, contextOnly = false) => (
    <Row
      key={category.id}
      category={category}
      level={level}
      palette={palette}
      figure={figure}
      top={top}
      currency={currency}
      used={activity.has(category.id) || all.some((one) => one.parentId === category.id && activity.has(one.id))}
      contextOnly={contextOnly}
      isEditing={editing === category.id}
      selected={selected?.id === category.id}
      extra={extra}
      onOpen={() => open(category)}
      onEdit={() => setEditing(category.id)}
      onRename={(name) => {
        setEditing(undefined)
        if (name !== '' && name !== category.name) write((database, now) => renameCategory(database, category.id, name, now))
      }}
      onSetAppearance={(appearance) => write((database, now) => setCategoryAppearance(database, category.id, appearance, now))}
      onMenu={(at) => setMenu({ category, at })}
      onKeyDown={(event) => rowKeys(category, event)}
    />
  )

  /** The note a thing just done leaves where it happened, with its Undo. */
  const note = (
    <li key="done" className="fc-pop-enter flex h-10 items-center gap-3 border-b border-hairline ps-9 text-ink-secondary">
      <Bidi>{done?.say ?? ''}</Bidi>
      <button type="button" className="fc-text-action" onClick={undo} title={t('categories.undoTitle')}>
        {t('categories.undo')}
      </button>
    </li>
  )

  const isUnused = (category: Category): boolean => !activity.has(category.id) && !category.isSystem
  const group = (section: TaxonomySection, top: number) => {
    const head = section.category
    const total =
      monthOf(head) +
      section.rows.reduce(
        (sum, row) => sum + monthOf(row.category) + row.children.reduce((s, child) => s + monthOf(child), 0),
        0,
      )
    // A search hides nothing: hiding the answer behind a closed group is the one thing a search must never do.
    const showing = searching || showUnused.has(head.id)
    const rows = section.rows
      .map((row) => ({ ...row, children: row.children.filter((child) => showing || !isUnused(child)) }))
      .filter((row) => showing || !isUnused(row.category) || row.children.length > 0)
    const hidden = section.rows.length + section.rows.reduce((n, row) => n + row.children.length, 0) -
      rows.length - rows.reduce((n, row) => n + row.children.length, 0)
    const toggle = section.unused > 0 && !searching && (
      <button
        type="button"
        className="fc-text-action text-caption"
        aria-expanded={showing}
        onClick={(event) => {
          event.stopPropagation()
          setShowUnused((current) => {
            const next = new Set(current)
            if (next.has(head.id)) next.delete(head.id)
            else next.add(head.id)
            return next
          })
        }}
      >
        {showing ? t('categories.hideUnused') : t(countKey('categories.nUnused', hidden || section.unused), { count: hidden || section.unused })}
      </button>
    )
    return (
      <section key={head.id} className="flex flex-col">
        <ul className="m-0 list-none p-0">
          {rowFor(head, 'head', total, top, toggle, section.contextOnly)}
        </ul>
        {(rows.length > 0 || done?.group === head.id) && (
          // A category made, merged, archived or moved under another (M39).
          <Flip
            as="ul"
            className="m-0 list-none p-0"
            flipKey={rows.flatMap((row) => [row.category.id, ...row.children.map((child) => child.id)]).join(',')}
          >
            {rows.map((row) => (
              <Fragment key={row.category.id}>
                {rowFor(row.category, 'row', monthOf(row.category) + row.children.reduce((sum, child) => sum + monthOf(child), 0), top, undefined, row.contextOnly)}
                {row.children.map((child) => rowFor(child, 'nested', monthOf(child), top))}
              </Fragment>
            ))}
            {done !== undefined && done.group === head.id && note}
          </Flip>
        )}
      </section>
    )
  }

  const monthLabel = period === undefined ? undefined : parseYearMonth(period)
  const at = period === undefined ? -1 : months.indexOf(period)
  const short = (month: string | undefined): string | undefined => {
    const parsed = month === undefined ? undefined : parseYearMonth(month)
    return parsed === undefined ? undefined : dates.monthShort(parsed)
  }
  const spending = parts.find((one) => one.part === 'SPENDING')?.here ?? []
  const spendingUsed = spending.filter((category) => monthOf(category) > 0).length
  const anything = parts.some((one) => one.sections.length > 0)

  const page = (
    <div className="fc-view-enter @container flex flex-col gap-6 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="m-0 text-title leading-tight font-medium">{t('categories.title')}</h1>
          {monthLabel !== undefined && months.length > 1 && (
            <Pager
              label={t('categories.month')}
              prev={short(months[at + 1])}
              next={short(months[at - 1])}
              onPrev={() => setWanted(months[at + 1])}
              onNext={() => setWanted(months[at - 1])}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
            placeholder={t('categories.find')}
            aria-label={t('categories.findLabel')}
            className={`${FIELD} w-52`}
          />
          <PageMenu
            title={t('categories.title')}
            items={[
              {
                label: showArchived ? t('categories.hideArchived') : t('categories.showArchived'),
                onChoose: () => setShowArchived(!showArchived),
              },
            ]}
          />
          <Button
            variant="primary"
            icon="add"
            onClick={() => {
              setPicked(undefined)
              setAdding(true)
            }}
            aria-expanded={adding}
            data-guide="categories.new"
          >
            {t('categories.newCategory')}
          </Button>
        </div>
      </header>

      <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">
        {spending.length === 0
          ? t('categories.answerNone')
          : monthLabel === undefined
            ? t(countKey('categories.answerNoMonth', spending.length), { count: spending.length })
            : t(countKey('categories.answer', spending.length), {
                count: spending.length,
                used: spendingUsed,
                month: dates.yearMonth(monthLabel),
              })}
      </p>

      {problem !== undefined && (
        <p role="alert" className="fc-pop-enter m-0 flex flex-wrap items-baseline gap-x-3">
          <span className="text-negative">{problem}</span>
          <button type="button" className="fc-text-action" onClick={() => setProblem(undefined)}>
            {t('categories.dismiss')}
          </button>
        </p>
      )}

      <WaitingList
        label={t('categories.unusedLabel')}
        items={
          crowded && !searching
            ? [
                {
                  key: 'unused',
                  say: t('categories.unusedOffer', { unused: unused.length, all: liveOwn.length }),
                  why: t('categories.unusedWhy'),
                  verb: t('categories.archiveThem'),
                  onDo: () => {
                    const ids = unused.map((category) => category.id)
                    write((database, now) => {
                      for (const id of ids) setCategoryArchived(database, id, true, now)
                    })
                    setDone({
                      say: t(countKey('categories.archivedMany', ids.length), { count: ids.length }),
                      group: 'unused',
                      undo: () =>
                        write((database, now) => {
                          for (const id of ids) setCategoryArchived(database, id, false, now)
                        }),
                    })
                  },
                },
              ]
            : []
        }
      />
      {done !== undefined && (done.group === 'unused' || done.group === undefined) && (
        <ul className="m-0 -mt-3 list-none border-t border-hairline p-0">{note}</ul>
      )}

      {!anything && (
        <p className="m-0 text-ink-secondary">
          {searching ? t('categories.emptySearch', { search: search.trim() }) : t('categories.emptyDocument')}
        </p>
      )}

      {parts.map(({ part, here, sections }) => {
        if (sections.length === 0) return null
        const top = Math.max(1, ...here.map((category) => monthOf(category)))
        return (
          <section key={part} className="flex flex-col gap-2" aria-labelledby={`categories-${part}`} data-block>
            <h2 id={`categories-${part}`} className="m-0 text-heading font-medium">
              {t(`categories.parts.${part}`)}
            </h2>
            <div className="flex flex-col gap-4">{sections.map((section) => group(section, top))}</div>
          </section>
        )
      })}
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>

      {adding ? (
        <SidePanel title={t('categories.newCategory')} onClose={() => setAdding(false)}>
          <NewCategoryForm
            parents={parents}
            onCreate={(input) => {
              write((database, now) => {
                const id = createCategory(database, input, now)
                setPicked(id)
              })
              setAdding(false)
            }}
          />
        </SidePanel>
      ) : selected !== undefined ? (
        <SidePanel
          key={selected.id}
          kicker={selected.parentId === undefined ? t('categories.topLevel') : pathArrows(all.find((one) => one.id === selected.parentId)?.path ?? '')}
          title={<CategoryMark color={palette.colorOf(selected.id)}>{selected.name}</CategoryMark>}
          onClose={() => {
            setPicked(undefined)
            setAsking(undefined)
          }}
        >
          <CategoryPanel
            category={selected}
            palette={palette}
            currency={currency}
            period={period}
            series={seriesOf(selected)}
            asking={asking}
            rules={rules.filter((rule) => rule.targetCategoryId === selected.id && rule.origin !== 'BUILT_IN')}
            merchants={
              period === undefined ? [] : categoryMerchants(db, selected.id, monthsAgo(period, YEAR - 1), period, currency, 5)
            }
            onSetAppearance={(appearance) =>
              write((database, now) => setCategoryAppearance(database, selected.id, appearance, now))
            }
            budget={budgets.get(selected.id)}
            hasPlan={hasPlan}
            onSetTarget={(target) =>
              write((database, now) => {
                const result = setCategoryBudget(database, today(), currency, selected.id, target?.minor ?? 0, now)
                if (result === 'SEVERAL_BUCKETS') {
                  throw new Error(t('categories.severalBuckets', { name: selected.name }))
                }
              })
            }
            homes={parentsFor(all, selected)}
            onSetParent={(parentId) => write((database, now) => reparentCategory(database, selected.id, parentId, now))}
            mergeTargets={visible.filter((candidate) => candidate.id !== selected.id && !candidate.isArchived)}
            onMerge={(intoId) => {
              setPicked(intoId)
              write((database, now) => mergeCategories(database, selected.id, intoId, now))
            }}
            deleteTargets={isCategoryInUse(categoryUsage(db, selected.id)) ? categoryDeleteTargets(db, selected.id) : []}
            using={usageWords(categoryUsage(db, selected.id))}
            onDelete={(moveTo) => {
              if (moveTo === undefined) {
                remove(selected)
                return
              }
              setPicked(undefined)
              write((database, now) => deleteCategory(database, selected.id, now, moveTo))
            }}
            onRename={() => setEditing(selected.id)}
            onArchive={() => archive(selected)}
            onShowRows={() =>
              navigate('/transactions', { state: { category: selected.id, ...(period === undefined ? {} : { period }) } })
            }
            onRules={() => navigate('/categories/rules')}
          />
        </SidePanel>
      ) : null}

      {menu !== undefined && (
        <ContextMenu
          at={menu.at}
          items={menuItems(menu.category)}
          onClose={() => setMenu(undefined)}
          header={{
            title: <Bidi>{menu.category.name}</Bidi>,
            sub: (
              <>
                <Bidi>
                  {pathArrows(all.find((one) => one.id === menu.category.parentId)?.path ?? t('categories.topLevel'))}
                </Bidi>
                {monthOf(menu.category) > 0 && monthLabel !== undefined
                  ? t('categories.menuFigure', {
                      amount: whole(money(monthOf(menu.category), currency)),
                      month: dates.monthShort(monthLabel),
                    })
                  : ''}
              </>
            ),
          }}
        />
      )}
    </div>
  )
}

/** Whole shekels, for a list: the agorot are the panel's. */
function whole(amount: Money): string {
  return formatMoney(amount).replace(/\.\d+$/, '')
}

/** `YYYY-MM` this many months before `period`. */
function monthsAgo(period: string, count: number): string {
  const parsed = parseYearMonth(period)
  return parsed === undefined ? period : toYearMonthString(addMonths(parsed, -count))
}

/** A group's heading, a category under it, or one a level further down. */
type Level = 'head' | 'row' | 'nested'

function Row({
  category,
  level,
  palette,
  figure,
  top,
  currency,
  used,
  contextOnly,
  isEditing,
  selected,
  extra,
  onOpen,
  onEdit,
  onRename,
  onSetAppearance,
  onMenu,
  onKeyDown,
}: {
  category: Category
  level: Level
  palette: CategoryPalette
  /** What it holds in the month shown — a heading, everything under it — in the document's currency. */
  figure: number
  /** The largest figure in its part, which is what a full bar is. */
  top: number
  currency: string
  used: boolean
  /** Shown only to hold up a matching child, so it is drawn as scaffolding. */
  contextOnly: boolean
  isEditing: boolean
  selected: boolean
  /** After the name: a heading's *n unused*. */
  extra?: React.ReactNode
  onOpen: () => void
  onEdit: () => void
  onRename: (name: string) => void
  onSetAppearance: (appearance: { color: string | undefined; icon: string | undefined }) => void
  onMenu: (at: { x: number; y: number }) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}) {
  const t = useT()
  const colour = palette.colorOf(category.id)
  const head = level === 'head'
  return (
    <li
      data-motion-key={category.id}
      data-category-row
      tabIndex={0}
      onClick={onOpen}
      onDoubleClick={() => !category.isSystem && onEdit()}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu({ x: event.clientX, y: event.clientY })
      }}
      aria-current={selected ? 'true' : undefined}
      className={`group relative grid h-10 cursor-pointer grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_2rem] items-center gap-x-3 pe-1 outline-none transition-colors duration-[var(--duration-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
        head ? 'border-b border-hairline-strong' : 'border-b border-hairline'
      } ${level === 'nested' ? 'ps-12' : level === 'row' ? 'ps-6' : ''} ${
        selected ? 'bg-accent-soft before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent' : 'hover:bg-surface'
      } ${contextOnly ? 'text-ink-secondary' : ''}`}
    >
      <span className="flex min-w-0 items-center gap-2" onClick={(event) => isEditing && event.stopPropagation()}>
        {/* The dot is the colour control: what a category is drawn in is changed where it is drawn. */}
        <span onClick={(event) => event.stopPropagation()} className="flex">
          <AppearancePicker
            id={category.id}
            name={category.name}
            color={category.color}
            icon={category.icon}
            palette={palette}
            onChange={onSetAppearance}
          />
        </span>
        {isEditing ? (
          <input
            autoFocus
            defaultValue={category.name}
            aria-label={t('categories.renameName', { name: category.name })}
            onBlur={(event) => onRename(event.target.value.trim())}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') onRename(category.name)
            }}
            className={`${FIELD} h-7`}
          />
        ) : (
          <Bidi className={`min-w-0 truncate ${head ? 'font-medium' : ''}`}>{category.name}</Bidi>
        )}
        {category.isArchived && <Tag>{t('categories.tagArchived')}</Tag>}
        {category.isSystem && <Tag>{t('categories.tagSystem')}</Tag>}
        {!head && !used && !category.isSystem && <Tag>{t('categories.unused')}</Tag>}
        {extra}
      </span>

      <span aria-hidden className="block">
        {!head && (
          <span
            className="block h-1.5 rounded-e-mark transition-[width] duration-[var(--duration-base)]"
            style={{ width: `${figure > 0 ? Math.max(3, Math.round((100 * figure) / top)) : 0}%`, backgroundColor: colour }}
          />
        )}
      </span>

      <span className={`text-end tabular-nums ${head ? 'font-medium' : ''}`}>
        {figure > 0 ? whole(money(figure, currency)) : <span className="text-ink-secondary">—</span>}
      </span>

      <span className="flex justify-end opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 group-focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
        <IconAction
          label={t('categories.moreFor', { name: category.name })}
          onClick={(event) => {
            const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
            onMenu({ x: box.right - 4, y: box.bottom + 2 })
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

/**
 * **What one category holds**, beside the list: its month against its year,
 * the shops its money goes to, the rules that file into it, its bucket, where
 * it sits and its colour — the facts that decide whether it is worth keeping —
 * and what can be done to it. Merge and a delete that moves rows ask at their
 * buttons (D-617); where it sits is changed in place.
 *
 * The figures are the document's currency only and leave out every row left
 * out of the totals, so the panel and Home agree.
 */
function CategoryPanel({
  category,
  palette,
  currency,
  period,
  series,
  asking,
  rules,
  merchants,
  onSetAppearance,
  budget,
  hasPlan,
  onSetTarget,
  homes,
  onSetParent,
  mergeTargets,
  onMerge,
  deleteTargets,
  using,
  onDelete,
  onRename,
  onArchive,
  onShowRows,
  onRules,
}: {
  category: Category
  palette: CategoryPalette
  currency: string
  period: string | undefined
  series: readonly number[] | undefined
  /** What the menu asked the panel to open on. */
  asking: Asking | undefined
  rules: readonly { readonly id: string; readonly name: string }[]
  merchants: readonly { readonly merchantRaw: string; readonly count: number; readonly outflowMinor: number }[]
  onSetAppearance: (appearance: { color: string | undefined; icon: string | undefined }) => void
  budget: Money | undefined
  hasPlan: boolean
  onSetTarget: (target: Money | undefined) => void
  /** Where it can go (`parentsFor`): its own kind, with room for what it carries. */
  homes: readonly Category[]
  onSetParent: (parentId: string | undefined) => void
  mergeTargets: readonly Category[]
  onMerge: (intoId: string) => void
  /** Where what uses it can move; nothing when nothing uses it, and it goes at once. */
  deleteTargets: readonly Category[]
  using: string
  onDelete: (moveTo: string | undefined) => void
  onRename: () => void
  onArchive: () => void
  onShowRows: () => void
  onRules: () => void
}) {
  const t = useT()
  const dates = useDates()
  const [into, setInto] = useState<string | undefined>()
  const [moveTo, setMoveTo] = useState<string | undefined>()
  const bars = series ?? Array.from({ length: YEAR }, () => 0)
  const month = bars.at(-1) ?? 0
  const average = Math.round(bars.reduce((sum, value) => sum + value, 0) / YEAR)
  const over =
    budget === undefined || budget.minor === 0 || month === 0
      ? undefined
      : Math.round((100 * (month - budget.minor)) / budget.minor)
  const parsed = period === undefined ? undefined : parseYearMonth(period)
  const monthName = parsed === undefined ? t('categories.panel.theMonth') : dates.monthShort(parsed)
  const named = <Bidi className="font-medium">{category.name}</Bidi>

  return (
    <>
      <HeadlineFigure
        label={parsed === undefined ? t('categories.panel.theMonth') : dates.yearMonth(parsed)}
        value={money(month, currency)}
        change={t('categories.panel.average', { amount: whole(money(average, currency)) })}
        trend={bars}
        empty={t('categories.panel.nothingYear')}
      />

      {!category.isSystem && (
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-ink-secondary uppercase">{t('categories.panel.under')}</span>
          {/* Where it sits is one value of one thing, so it changes in place (D-617). */}
          <ParentPicker parents={homes} value={category.parentId ?? ''} onChange={(id) => onSetParent(id === '' ? undefined : id)} fill />
          {asking === 'under' && homes.length === 0 && (
            <span className="text-caption text-ink-secondary">{t('categories.move.noRoom', { kind: t(`categories.kinds.${category.kind}`) })}</span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-label text-ink-secondary uppercase">{t('categories.panel.whereItGoes')}</span>
        <RankedBars
          rows={merchants.map((one) => ({ key: one.merchantRaw, name: one.merchantRaw, value: money(one.outflowMinor, currency) }))}
          limit={merchants.length}
          empty={t('categories.panel.nothingYear')}
        />
      </div>

      {!category.isSystem && (
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-ink-secondary uppercase">{t('categories.panel.eachMonth')}</span>
          <div className="flex items-center gap-3">
            <MonthlyTarget category={category} budget={budget} currency={currency} onSet={onSetTarget} />
            {over !== undefined && (
              <span className="text-caption text-ink-secondary tabular-nums">
                {t(over >= 0 ? 'categories.panel.over' : 'categories.panel.under_', { month: monthName, n: Math.abs(over) })}
              </span>
            )}
          </div>
          <span className="text-caption text-ink-secondary">
            {hasPlan ? t('categories.panel.sameFigure') : t('categories.panel.startsPlan')}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-label text-ink-secondary uppercase">{t('categories.panel.rulesHere', { n: rules.length })}</span>
        {rules.length === 0 ? (
          <span className="text-ink-secondary">{t('categories.panel.noneYet')}</span>
        ) : (
          <ul className="m-0 list-none p-0">
            {rules.slice(0, 5).map((rule) => (
              <li key={rule.id} className="flex h-8 items-center border-b border-hairline">
                <Bidi className="min-w-0 truncate">{rule.name}</Bidi>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="fc-text-action self-start" onClick={onRules}>
          {t('categories.panel.openRules')}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-label text-ink-secondary uppercase">{t('categories.panel.colour')}</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('categories.panel.colourOf', { name: category.name })}>
          {CATEGORY_COLOR_TOKENS.map((slot, index) => {
            const worn = palette.peersWearing(category.id, slot)
            const chosen = category.color === slot
            return (
              <button
                key={slot}
                type="button"
                aria-label={
                  worn.length === 0
                    ? t('categories.panel.hue', { n: index + 1 })
                    : t('categories.panel.hueAlso', { n: index + 1, names: worn.join(', ') })
                }
                aria-pressed={chosen}
                title={worn.length === 0 ? t('categories.panel.hueTitle', { n: index + 1 }) : t('categories.panel.siblingWears', { names: worn.join(', ') })}
                onClick={() => onSetAppearance({ color: slot, icon: category.icon })}
                className={`flex size-6 items-center justify-center rounded-full border-2 ${chosen ? 'border-ink' : 'border-transparent'}`}
              >
                <i
                  className="block size-3.5 rounded-full"
                  style={{
                    backgroundColor: token(slot),
                    boxShadow: worn.length > 0 ? 'inset 0 0 0 2px var(--color-background)' : undefined,
                  }}
                />
              </button>
            )
          })}
          <button
            type="button"
            aria-label={t('categories.panel.automatic')}
            aria-pressed={category.color === undefined}
            title={t('categories.panel.automaticTitle')}
            onClick={() => onSetAppearance({ color: undefined, icon: category.icon })}
            className={`flex size-6 items-center justify-center rounded-full border-2 ${category.color === undefined ? 'border-ink' : 'border-transparent'}`}
          >
            <i className="block size-3.5 rounded-full border border-dashed border-ink-secondary" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
        <Button variant="secondary" size="sm" icon="filter" onClick={onShowRows}>
          {t('categories.panel.itsRows')}
        </Button>
        {!category.isSystem && (
          <Button variant="secondary" size="sm" icon="edit" onClick={onRename}>
            {t('categories.panel.rename')}
          </Button>
        )}
        {!category.isSystem && (
          <AskAtButton
            key={`merge-${asking ?? ''}`}
            label={t('categories.panel.mergeInto')}
            icon="merge"
            startOpen={asking === 'merge'}
            question={<Phrase text={t('categories.merge.intro')} parts={{ name: named }} />}
            confirm={t('categories.merge.merge')}
            cancel={t('categories.merge.cancel')}
            canConfirm={into !== undefined}
            onConfirm={() => into !== undefined && onMerge(into)}
          >
            <CategoryPicker categories={mergeTargets} value={into} onChange={setInto} label={t('categories.merge.into')} placeholder={t('categories.merge.choose')} />
          </AskAtButton>
        )}
        {!category.isSystem && (
          <Button variant="ghost" size="sm" icon="archive" onClick={onArchive}>
            {category.isArchived ? t('categories.restore') : t('categories.archive')}
          </Button>
        )}
        {!category.isSystem &&
          (deleteTargets.length === 0 ? (
            <Button variant="ghost" size="sm" icon="trash" onClick={() => onDelete(undefined)}>
              {t('categories.panel.delete')}
            </Button>
          ) : (
            <AskAtButton
              key={`delete-${asking ?? ''}`}
              label={t('categories.panel.delete')}
              icon="trash"
              startOpen={asking === 'delete'}
              question={<Phrase text={t('categories.remove.intro', { using })} parts={{ name: named }} />}
              confirm={t('categories.remove.moveAndDelete')}
              cancel={t('categories.remove.cancel')}
              canConfirm={moveTo !== undefined}
              onConfirm={() => moveTo !== undefined && onDelete(moveTo)}
            >
              <CategoryPicker categories={deleteTargets} value={moveTo} onChange={setMoveTo} label={t('categories.remove.moveTo')} placeholder={t('categories.remove.moveToChoose')} />
            </AskAtButton>
          ))}
      </div>
    </>
  )
}

/**
 * A category's soft monthly target — docs/f02's advisory figure, and the column
 * that has existed since migration 002 with nothing to edit it.
 *
 * **Advisory means advisory**: no alert, no blocking, no effect on what a
 * transaction may be. It is a line to compare against, and from M6 a line the
 * charts actually draw. The placeholder says "no target" rather than showing a
 * zero, because a target of nothing and a target of ₪0 are different claims.
 *
 * Empty clears it. Read with the importer's own `parseAmountText`, so a figure
 * pasted from anywhere in the app works.
 */
function MonthlyTarget({
  category,
  budget,
  currency,
  onSet,
}: {
  category: Category
  budget: Money | undefined
  currency: string
  onSet: (target: Money | undefined) => void
}) {
  const t = useT()
  const shown = budget
  const [text, setText] = useState(
    shown === undefined ? '' : formatMoney(shown, { symbol: false }),
  )

  // The splitter can change this underneath the row, so the field follows the
  // stored value whenever it is not being typed into.
  const stored = shown === undefined ? '' : formatMoney(shown, { symbol: false })
  const [lastStored, setLastStored] = useState(stored)
  if (stored !== lastStored) {
    setLastStored(stored)
    setText(stored)
  }

  const commit = (): void => {
    if (text.trim() === '') {
      if (shown !== undefined) onSet(undefined)
      return
    }
    const parsed = parseAmountText(text)
    if (parsed === undefined) {
      setText(stored)
      return
    }
    const next = fromMajorUnits(Math.abs(parsed), currency)
    if (next.minor !== shown?.minor) onSet(next)
  }

  return (
    <label className="flex items-center gap-2 text-caption text-ink-secondary">
      <span className="sr-only">
        <Phrase text={t('categories.target.bucketFor')} parts={{ name: <Bidi>{category.name}</Bidi> }} />
      </span>
      <span aria-hidden>{t('categories.target.bucket')}</span>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setText(stored)
        }}
        placeholder={t('categories.target.none')}
        aria-label={t('categories.target.bucketFor', { name: category.name })}
        className={`${FIELD} h-7 w-24 text-end tabular-nums`}
      />
    </label>
  )
}

function NewCategoryForm({
  parents,
  onCreate,
}: {
  parents: readonly Category[]
  onCreate: (input: { name: string; kind: CategoryKind; parentId?: string | undefined }) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('EXPENSE')
  const [parentId, setParentId] = useState('')

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') return

    const parent = parents.find((candidate) => candidate.id === parentId)
    // A subcategory inherits its parent's kind — enforced in `createCategory`
    // now, so this form states the choice and the repository resolves it for
    // every writer rather than for this one.
    onCreate({ name: trimmed, kind, parentId: parent?.id })
    setName('')
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t('categories.create.placeholder')}
        aria-label={t('categories.create.name')}
        className={`${FIELD} w-full`}
        autoFocus
      />

      <ParentPicker parents={parents} value={parentId} onChange={setParentId} fill />

      {parentId === '' && (
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as CategoryKind)}
          aria-label={t('categories.create.kind')}
          className={SELECT}
        >
          {(['EXPENSE', 'INCOME', 'TRANSFER', 'SAVING', 'DEBT_PAYMENT'] as const).map((option) => (
            <option key={option} value={option}>
              {t(`categories.kinds.${option}`)}
            </option>
          ))}
        </select>
      )}

      <Button variant="primary" type="submit" className="self-start">
        {t('categories.create.add')}
      </Button>
    </form>
  )
}

/** Metadata, not a badge (docs/11): a quiet caption, no pill and no border. */
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 text-caption tracking-wide text-ink-secondary uppercase">{children}</span>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
