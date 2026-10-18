import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatMoney, fromMajorUnits, money, type Money } from '@/core/money.ts'
import { listed } from '@/core/text.ts'
import {
  addMonths,
  formatMonthShort,
  formatYearMonth,
  parseYearMonth,
  toYearMonthString,
} from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import {
  categoryActivity,
  categoryDeleteTargets,
  categoryMerchants,
  categorySeries,
  categoryUsage,
  createCategory,
  deleteCategory,
  describeCategoryUsage,
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
} from '@/data/repositories/categoryRepository.ts'
import { categoryBudgets, setCategoryBudget } from '@/data/repositories/categoryBudgetRepository.ts'
import { listSplitPlans } from '@/data/repositories/splitPlanRepository.ts'
import { today } from '@/ui/today.ts'
import { loadRules } from '@/data/repositories/ruleSetRepository.ts'
import { monthlyTotals } from '@/data/repositories/transactionRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { CATEGORY_COLOR_TOKENS } from '@/domain/categoryColors.ts'
import { isMovedKind } from '@/data/repositories/movedRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { AppearancePicker } from '@/ui/categories/AppearancePicker.tsx'
import { buildTaxonomy, type TaxonomyRow } from '@/ui/categories/taxonomyView.ts'
import { token } from '@/ui/charts/categoryColor.ts'
import { type CategoryPalette } from '@/ui/charts/categoryPalette.ts'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { CategoryMark, useCategoryPalette } from '@/ui/components/CategoryMark.tsx'
import { ContextMenu, isMenuKey, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { Pager } from '@/ui/home/parts.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { ParentPicker } from '@/ui/categories/ParentPicker.tsx'
import { eligibleParents, parentsFor } from '@/ui/categories/parentFilter.ts'
import { Flip } from '@/ui/motion/Flip.tsx'

/** The three tabs, by what a category is: what you spend, what moved, what came in. */
type Tab = 'SPENDING' | 'MOVED' | 'INCOME'

const TAB_LABEL: Readonly<Record<Tab, string>> = {
  SPENDING: 'Spending',
  MOVED: 'Money moved',
  INCOME: 'Income',
}

// The same list the totals read (D-316): a category here is moved, not spent.
const tabOf = (kind: CategoryKind): Tab => (kind === 'INCOME' ? 'INCOME' : isMovedKind(kind) ? 'MOVED' : 'SPENDING')

/** A year of months, for the panel's bars. */
const YEAR = 12

/**
 * The taxonomy, and the operations of docs/f02 on it: create, rename, reparent,
 * merge, archive, delete, reorder — in the design approved for M28 U6
 * (D-315): **the list, and a panel for the one you pick** (choice 3 B).
 *
 * The shape of the screen follows the shape of the rule that governs it —
 * **Delete moves first** (M28 F18, D-340). A category nothing uses goes; one
 * that rows, rules, budgets or children still use asks which category of its
 * kind takes them, moves them, then goes — and with nowhere to move them it is
 * refused by what still uses it. The panel, the menu and the Delete key.
 *
 * What changed with U6, and what did not:
 *
 * - **A row is a dot, a name, the month's bar and its figure.** The seven
 *   buttons it carried (↑ ↓ Move Merge Archive Delete, and a target field) are
 *   in the right-click menu and in the panel, so forty-six rows read as names
 *   and not as a wall of controls.
 * - **The panel says what a category holds**: twelve months, the merchants the
 *   money goes to, the rules that file here, the monthly target, and the colour.
 * - **Colours are eleven hues, dots beside the name** (D-314), resolved over the
 *   whole taxonomy (`resolvePalette`) so the dot on a row is the wedge in the
 *   donut and a hue a sibling already wears is marked as taken.
 * - **The starter set can go in one go** (S4): when most of it has never held a
 *   row, one line offers to archive those together. Archiving keeps whatever is
 *   filed, and *Show archived* brings them back.
 *
 * **Unchanged**: *unused* is still the word the screen exists to say, a system
 * category cannot be renamed, moved or deleted, and the refusals read the same.
 */
export function Categories() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()

  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('SPENDING')
  const [picked, setPicked] = useState<string | undefined>()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<string | undefined>()
  const [merging, setMerging] = useState<Category | undefined>()
  const [moving, setMoving] = useState<Category | undefined>()
  const [deleting, setDeleting] = useState<
    { readonly category: Category; readonly using: string; readonly targets: readonly Category[] } | undefined
  >()
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()
  const [menu, setMenu] = useState<
    { readonly category: Category; readonly at: { readonly x: number; readonly y: number } } | undefined
  >()
  const [wanted, setWanted] = useState<string | undefined>()

  // One read, archived included, and the two consumers take what they need:
  // the palette resolves over the live ones only (an archived category must not
  // push a live one onto another hue), and the list below shows what the
  // checkbox asks for.
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
  const period = wanted !== undefined && months.includes(wanted) ? wanted : months[0]
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
  const inTab = useMemo(() => visible.filter((category) => tabOf(category.kind) === tab), [visible, tab])

  const sections = useMemo(
    () => buildTaxonomy(inTab, { search, used: (id) => activity.has(id) }),
    [inTab, search, activity],
  )

  // The panel is about one category, and there is always one: the one picked if
  // it is still on this tab, otherwise the first that holds anything.
  const selected = useMemo(() => {
    const here = sections.flatMap((section) => [
      section.category,
      ...section.rows.flatMap((row) => [row.category, ...row.children]),
    ])
    return (
      here.find((category) => category.id === picked) ??
      here.find((category) => (series.out.get(category.id) ?? series.in.get(category.id))?.at(-1) !== undefined && monthOf(category) > 0) ??
      here[0]
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, picked, series])

  useEffect(() => {
    // Leaving a tab for one the picked category is not on lets the default take over.
    if (picked !== undefined && selected !== undefined && selected.id !== picked) setPicked(undefined)
  }, [picked, selected])

  if (db === undefined) {
    return <Centered>Open a document, or create one, to edit its categories.</Centered>
  }

  const write = (work: (database: import('sql.js').Database, now: number) => void): void => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
    } catch (error) {
      // A refusal is information, not a crash: it is how the user finds out
      // that the thing they wanted needs a merge instead.
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * **Delete, the chosen way** (M28 F18, D-340): nothing uses it, it goes;
   * something does, and the panel at the foot asks where all of it moves
   * first; nowhere of its kind to move it, and it is refused by what still uses
   * it. The repository judges every one of those, so this only picks the door.
   */
  const remove = (category: Category): void => {
    setProblem(undefined)
    if (category.isSystem) return
    const usage = categoryUsage(db, category.id)
    if (!isCategoryInUse(usage)) {
      write((database, now) => deleteCategory(database, category.id, now))
      return
    }
    const using = listed(describeCategoryUsage(usage), 'nothing')
    const targets = categoryDeleteTargets(db, category.id)
    if (targets.length === 0) {
      setProblem(
        `${category.name} still has ${using}, and there is no other ${TAB_LABEL[tabOf(category.kind)].toLowerCase()} ` +
          `category${usage.subcategories > 0 ? ' with room for its subcategories' : ''} to move them to. Make one, or archive it instead.`,
      )
      return
    }
    setMerging(undefined)
    setMoving(undefined)
    setDeleting({ category, using, targets })
  }

  // What a new category can go under: anything with room below it, three levels
  // deep (M28 F29), that is not built in or archived.
  const parents = eligibleParents(all)

  /**
   * **S4: the starter set, put away in one go.** A category nothing has ever
   * been filed under, that nothing points at and that holds no target, is the
   * thing a taxonomy that grew wrong is made of. A parent goes only when every
   * child of it does too. Archived is not deleted: what is filed stays filed,
   * and *Show archived* brings them back.
   */
  const unused = useMemo(() => {
    const live = all.filter((category) => !category.isArchived && !category.isSystem)
    const targeted = new Set(rules.filter((rule) => rule.origin !== 'BUILT_IN').map((rule) => rule.targetCategoryId))
    const free = (category: Category): boolean =>
      !activity.has(category.id) && !targeted.has(category.id) && !budgets.has(category.id)
    const kids = (id: string): Category[] => live.filter((category) => category.parentId === id)
    return live.filter((category) => free(category) && kids(category.id).every(free))
  }, [all, activity, rules, budgets])
  const crowded = unused.length >= 5 && unused.length * 2 >= all.filter((category) => !category.isArchived && !category.isSystem).length

  const searching = search.trim() !== ''
  const top = Math.max(1, ...inTab.map((category) => monthOf(category)))

  const rowProps = (category: Category): RowHandlers => ({
    onEdit: () => setEditing(category.id),
    onRename: (name) => {
      setEditing(undefined)
      if (name !== '' && name !== category.name) {
        write((database, now) => renameCategory(database, category.id, name, now))
      }
    },
    onSetAppearance: (appearance) =>
      write((database, now) => setCategoryAppearance(database, category.id, appearance, now)),
    onMenu: (at) => {
      setPicked(category.id)
      setMenu({ category, at })
    },
  })

  const menuItems = (category: Category): readonly MenuItem[] => {
    const mine = rules.filter((rule) => rule.targetCategoryId === category.id && rule.origin !== 'BUILT_IN')
    const homes = parentsFor(all, category).filter((one) => one.id !== category.parentId)
    const items: MenuItem[] = []
    if (!category.isSystem) {
      items.push({ icon: 'edit', label: 'Rename', shortcut: 'F2', onChoose: () => setEditing(category.id) })
    }
    items.push({
      icon: 'palette',
      label: 'Colour',
      detail: 'In the panel beside the list',
      onChoose: () => setPicked(category.id),
    })
    if (!category.isSystem) {
      items.push(
        {
          icon: 'move',
          label: 'Move under…',
          disabled: homes.length === 0 && category.parentId === undefined,
          detail:
            homes.length === 0 && category.parentId === undefined
              ? 'What is under it already takes the three levels'
              : undefined,
          onChoose: () => setMoving(category),
        },
        {
          icon: 'merge',
          label: 'Merge into…',
          detail: 'Its rows and rules go with it',
          onChoose: () => setMerging(category),
        },
      )
    }
    items.push(
      { icon: 'arrow', label: 'Move up', separated: true, onChoose: () => write((d, now) => moveCategory(d, category.id, -1, now)) },
      { icon: 'arrow', label: 'Move down', onChoose: () => write((d, now) => moveCategory(d, category.id, 1, now)) },
      {
        icon: 'filter',
        label: 'Show its rows',
        separated: true,
        onChoose: () =>
          navigate('/transactions', { state: { category: category.id, ...(period === undefined ? {} : { period }) } }),
      },
      {
        icon: 'rule',
        label: 'Its rules',
        detail: mine.length === 0 ? 'None of yours categorize here yet' : `${mine.length} of yours`,
        onChoose: () => navigate('/categories/rules'),
      },
    )
    if (!category.isSystem) {
      const inUse = isCategoryInUse(categoryUsage(db, category.id))
      items.push(
        {
          icon: 'archive',
          label: category.isArchived ? 'Restore' : 'Archive',
          detail: category.isArchived ? undefined : 'Hidden from pickers, kept on every row it has',
          separated: true,
          onChoose: () => write((d, now) => setCategoryArchived(d, category.id, !category.isArchived, now)),
        },
        {
          icon: 'trash',
          label: 'Delete',
          shortcut: 'Del',
          detail: inUse ? 'Asks where what uses it goes first' : undefined,
          onChoose: () => remove(category),
        },
      )
    }
    return items
  }

  const renderRow = (category: Category, contextOnly = false, nested = false) => (
    <Row
      key={category.id}
      category={category}
      nested={nested}
      palette={palette}
      month={monthOf(category)}
      top={top}
      currency={currency}
      activity={activity.get(category.id)}
      contextOnly={contextOnly}
      isEditing={editing === category.id}
      selected={selected?.id === category.id}
      handlers={rowProps(category)}
      onSelect={() => setPicked(category.id)}
    />
  )

  const monthLabel = period === undefined ? undefined : parseYearMonth(period)
  const at = period === undefined ? -1 : months.indexOf(period)
  const short = (month: string | undefined): string | undefined => {
    const parsed = month === undefined ? undefined : parseYearMonth(month)
    return parsed === undefined ? undefined : formatMonthShort(parsed)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="fc-view-enter @container flex flex-col gap-5 px-8 pt-6 pb-12">
          <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-4">
            <div className="flex flex-col gap-1.5">
              <span className="fc-label text-ink-secondary uppercase tabular-nums">
                Categories · what each one holds{monthLabel === undefined ? '' : `, ${formatYearMonth(monthLabel)}`}
              </span>
              <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">Categories</h1>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {monthLabel !== undefined && months.length > 1 && (
                <Pager
                  label="Month"
                  prev={short(months[at + 1])}
                  next={short(months[at - 1])}
                  onPrev={() => setWanted(months[at + 1])}
                  onNext={() => setWanted(months[at - 1])}
                />
              )}
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearch('')
                }}
                placeholder="Find a category…"
                aria-label="Find a category"
                className={`${FIELD} w-52`}
              />
              {/* What files rows into these, one press away (D-373): Rules is
                  this section's other tab since M36 U10. */}
              <Button variant="ghost" size="sm" icon="rule" onClick={() => navigate('/categories/rules')}>
                Rules
              </Button>
              <Button
                variant="secondary"
                icon="add"
                onClick={() => setAdding((current) => !current)}
                aria-expanded={adding}
                data-guide="categories.new"
              >
                New category
              </Button>
              <PageMenu
                title="Categories"
                items={[
                  {
                    label: showArchived ? 'Hide archived categories' : 'Show archived categories',
                    onChoose: () => setShowArchived(!showArchived),
                  },
                ]}
              />
            </div>
          </header>

          {adding && (
            <div className="fc-pop-enter border-b border-hairline pb-4">
              <NewCategoryForm
                parents={parents}
                onCreate={(input) => {
                  write((database, now) => createCategory(database, input, now))
                }}
              />
            </div>
          )}

          <nav aria-label="Kind of category" className="flex border-b border-hairline">
            {(Object.keys(TAB_LABEL) as Tab[]).map((one) => (
              <button
                key={one}
                type="button"
                onClick={() => setTab(one)}
                aria-current={tab === one ? 'page' : undefined}
                className={`relative h-9 px-3.5 text-[13px] transition-colors duration-[var(--duration-micro)] ${
                  tab === one
                    ? 'text-ink after:absolute after:inset-x-3.5 after:-bottom-px after:h-0.5 after:bg-accent'
                    : 'text-ink-secondary hover:text-ink'
                }`}
              >
                {TAB_LABEL[one]}
                <span className="ml-1.5 font-mono text-caption text-ink-tertiary">
                  {visible.filter((category) => tabOf(category.kind) === one).length}
                </span>
              </button>
            ))}
          </nav>

          {crowded && tab === 'SPENDING' && !searching && (
            <section
              aria-label="Unused categories"
              className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-3.5 py-2.5"
            >
              <span className="min-w-0 flex-1">
                {unused.length} of your {all.filter((category) => !category.isArchived && !category.isSystem).length}{' '}
                categories have never held a row. Archive them together? They come back with Show archived categories, in the ⋯ menu.
              </span>
              <Button
                variant="secondary"
                size="sm"
                icon="archive"
                count={unused.length}
                onClick={() =>
                  write((database, now) => {
                    for (const category of unused) setCategoryArchived(database, category.id, true, now)
                  })
                }
              >
                Archive
              </Button>
            </section>
          )}

          {problem !== undefined && (
            <div className="fc-pop-enter flex items-center gap-4 bg-surface px-3.5 py-2">
              <span className="text-negative">{problem}</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
                Dismiss
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 items-start gap-6 @[56rem]:grid-cols-[minmax(0,1fr)_23.75rem]">
            <div
              className="flex min-w-0 flex-col gap-5"
              onKeyDown={(event) => {
                if (isMenuKey(event) && selected !== undefined) {
                  const box = (event.target as HTMLElement).getBoundingClientRect()
                  setMenu({ category: selected, at: { x: box.left + 120, y: box.bottom } })
                  event.preventDefault()
                }
                if (event.key === 'F2' && selected !== undefined && !selected.isSystem) {
                  event.preventDefault()
                  setEditing(selected.id)
                }
                // Delete on the selected category — never from inside a field,
                // where it is the key that deletes a character.
                if (
                  event.key === 'Delete' &&
                  selected !== undefined &&
                  !selected.isSystem &&
                  (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') === null
                ) {
                  event.preventDefault()
                  remove(selected)
                }
              }}
            >
              {sections.length === 0 && (
                <p className="m-0 py-6 text-ink-secondary">
                  {searching
                    ? `Nothing is called anything like “${search.trim()}”.`
                    : tab === 'SPENDING'
                      ? 'This document has no categories.'
                      : `No ${TAB_LABEL[tab].toLowerCase()} categories.`}
                </p>
              )}

              {sections.map((section) => {
                // A heading is a category (M28 F29): picked, renamed and opened
                // from the menu like a row, and its figure is everything under it.
                const head = section.category
                // A search collapses nothing: hiding the answer behind a closed
                // section is the one thing a search must never do.
                const isOpen = searching || !collapsed.has(head.id)
                const total =
                  monthOf(head) +
                  section.rows.reduce(
                    (sum, row) => sum + monthOf(row.category) + row.children.reduce((s, child) => s + monthOf(child), 0),
                    0,
                  )
                const isSelected = selected?.id === head.id
                const handlers = rowProps(head)
                return (
                  <section key={head.id} className="flex flex-col">
                    <h2
                      tabIndex={0}
                      onFocus={() => setPicked(head.id)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        handlers.onMenu({ x: event.clientX, y: event.clientY })
                      }}
                      aria-current={isSelected ? 'true' : undefined}
                      className={`group/heading relative m-0 flex h-9 items-center gap-2.5 border-b border-hairline-strong pr-1.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                        isSelected ? 'bg-accent-soft before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent' : ''
                      } ${section.contextOnly ? 'text-ink-tertiary' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setCollapsed((current) => {
                            const next = new Set(current)
                            if (next.has(head.id)) next.delete(head.id)
                            else next.add(head.id)
                            return next
                          })
                        }}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${head.name}`}
                        disabled={searching || section.rows.length === 0}
                        className="flex w-5 shrink-0 items-center justify-center text-ink-tertiary disabled:opacity-0"
                      >
                        <span aria-hidden>{isOpen ? '▾' : '▸'}</span>
                      </button>
                      <AppearancePicker
                        id={head.id}
                        name={head.name}
                        color={head.color}
                        icon={head.icon}
                        palette={palette}
                        onChange={handlers.onSetAppearance}
                      />
                      {editing === head.id ? (
                        <input
                          autoFocus
                          defaultValue={head.name}
                          aria-label={`Rename ${head.name}`}
                          onBlur={(event) => handlers.onRename(event.target.value.trim())}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                            if (event.key === 'Escape') handlers.onRename(head.name)
                          }}
                          className={`${FIELD} h-7 w-48`}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPicked(head.id)}
                          className="fc-label flex min-w-0 text-left text-ink uppercase"
                        >
                          <Bidi className="min-w-0 truncate">{head.name}</Bidi>
                        </button>
                      )}
                      {head.isArchived && <Tag>archived</Tag>}
                      {head.isSystem && <Tag>system</Tag>}
                      <span className="text-caption text-ink-tertiary tabular-nums">
                        {section.rows.length > 0
                          ? `${String(section.shown)}${section.unused > 0 ? ` · ${String(section.unused)} unused` : ''}`
                          : activity.get(head.id) === undefined && !head.isSystem
                            ? 'unused'
                            : ''}
                      </span>
                      <span className="ml-auto text-[13px] text-ink-secondary tabular-nums">
                        {total > 0 ? whole(money(total, currency)) : ''}
                      </span>
                      <span className="flex w-14 shrink-0 justify-end gap-0.5 opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover/heading:opacity-100 group-focus-within/heading:opacity-100">
                        {!head.isSystem && (
                          <button
                            type="button"
                            title="Rename (F2)"
                            aria-label={`Rename ${head.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              handlers.onEdit()
                            }}
                            className="flex size-7 items-center justify-center text-ink-secondary hover:text-ink"
                          >
                            <ActionGlyph name="edit" size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          title="More (right-click)"
                          aria-label={`More for ${head.name}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            const box = event.currentTarget.getBoundingClientRect()
                            handlers.onMenu({ x: box.right - 4, y: box.bottom + 2 })
                          }}
                          className="flex size-7 items-center justify-center text-ink-secondary hover:text-ink"
                        >
                          <ActionGlyph name="more" size={14} />
                        </button>
                      </span>
                    </h2>
                    {isOpen && section.rows.length > 0 && (
                      // A category made, merged, archived or moved under another (M39).
                      <Flip
                        as="ul"
                        className="m-0 list-none p-0"
                        flipKey={section.rows
                          .flatMap((row: TaxonomyRow) => [row.category.id, ...row.children.map((child) => child.id)])
                          .join(',')}
                      >
                        {section.rows.map((row: TaxonomyRow) => (
                          <Fragment key={row.category.id}>
                            {renderRow(row.category, row.contextOnly)}
                            {row.children.map((child) => renderRow(child, false, true))}
                          </Fragment>
                        ))}
                      </Flip>
                    )}
                  </section>
                )
              })}

              <p className="m-0 text-caption text-ink-secondary">
                The bar is {monthLabel === undefined ? 'the month' : formatYearMonth(monthLabel)}, in the category’s own
                colour. Right-click a category for the rest: rename, colour, move, merge, archive, delete.
              </p>
            </div>

            {selected !== undefined && (
              <CategoryPanel
                key={selected.id}
                category={selected}
                palette={palette}
                currency={currency}
                period={period}
                series={seriesOf(selected)}
                rules={rules.filter((rule) => rule.targetCategoryId === selected.id && rule.origin !== 'BUILT_IN')}
                merchants={
                  period === undefined
                    ? []
                    : categoryMerchants(db, selected.id, monthsAgo(period, YEAR - 1), period, currency, 5)
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
                      throw new Error(`Several of Plan's buckets are for ${selected.name}; edit them on Plan.`)
                    }
                  })
                }
                parentPath={all.find((one) => one.id === selected.parentId)?.path}
                homes={parentsFor(all, selected)}
                onSetParent={(parentId) => write((database, now) => reparentCategory(database, selected.id, parentId, now))}
                onRename={() => setEditing(selected.id)}
                onMerge={() => setMerging(selected)}
                onDelete={() => remove(selected)}
                onArchive={() =>
                  write((database, now) => setCategoryArchived(database, selected.id, !selected.isArchived, now))
                }
                onShowRows={() =>
                  navigate('/transactions', {
                    state: { category: selected.id, ...(period === undefined ? {} : { period }) },
                  })
                }
                onRules={() => navigate('/categories/rules')}
              />
            )}
          </div>
        </div>
      </div>

      {menu !== undefined && (
        <ContextMenu
          at={menu.at}
          items={menuItems(menu.category)}
          onClose={() => setMenu(undefined)}
          header={{
            title: <Bidi>{menu.category.name}</Bidi>,
            sub: (
              <>
                <Bidi>{all.find((one) => one.id === menu.category.parentId)?.path ?? 'Top level'}</Bidi>
                {monthOf(menu.category) > 0 && monthLabel !== undefined
                  ? ` · ${whole(money(monthOf(menu.category), currency))} in ${formatMonthShort(monthLabel)}`
                  : ''}
              </>
            ),
          }}
        />
      )}

      {moving !== undefined && (
        <MovePanel
          key={moving.id}
          source={moving}
          parents={parentsFor(all, moving)}
          onCancel={() => setMoving(undefined)}
          onMove={(parentId) => {
            setMoving(undefined)
            write((database, now) => reparentCategory(database, moving.id, parentId, now))
          }}
        />
      )}

      {deleting !== undefined && (
        <DeletePanel
          key={deleting.category.id}
          source={deleting.category}
          using={deleting.using}
          targets={deleting.targets}
          onCancel={() => setDeleting(undefined)}
          onDelete={(moveTo) => {
            setDeleting(undefined)
            write((database, now) => deleteCategory(database, deleting.category.id, now, moveTo))
          }}
        />
      )}

      {merging !== undefined && (
        <MergePanel
          key={merging.id}
          source={merging}
          targets={visible.filter((candidate) => candidate.id !== merging.id && !candidate.isArchived)}
          onCancel={() => setMerging(undefined)}
          onMerge={(intoId) => {
            setMerging(undefined)
            write((database, now) => mergeCategories(database, merging.id, intoId, now))
          }}
        />
      )}
    </div>
  )
}

/** Whole shekels, for a list: the agorot are the panel's. */
function whole(amount: Money): string {
  return formatMoney(amount).replace(/.d+$/, '')
}

/** `YYYY-MM` this many months before `period`. */
function monthsAgo(period: string, count: number): string {
  const parsed = parseYearMonth(period)
  return parsed === undefined ? period : toYearMonthString(addMonths(parsed, -count))
}

interface RowHandlers {
  onEdit: () => void
  onRename: (name: string) => void
  onSetAppearance: (appearance: { color: string | undefined; icon: string | undefined }) => void
  onMenu: (at: { x: number; y: number }) => void
}

function Row({
  category,
  nested,
  palette,
  month,
  top,
  currency,
  activity,
  contextOnly,
  isEditing,
  selected,
  handlers,
  onSelect,
}: {
  category: Category
  /** A third-level category, drawn under the second-level one it belongs to. */
  nested: boolean
  palette: CategoryPalette
  /** What this category holds in the month shown, in the document's currency. */
  month: number
  /** The largest figure on this tab, which is what a full bar is. */
  top: number
  currency: string
  activity: CategoryActivity | undefined
  /** Shown only to hold up a matching child, so it is drawn as scaffolding. */
  contextOnly: boolean
  isEditing: boolean
  selected: boolean
  handlers: RowHandlers
  onSelect: () => void
}) {
  const colour = palette.colorOf(category.id)
  return (
    <li
      data-motion-key={category.id}
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
      onContextMenu={(event) => {
        event.preventDefault()
        handlers.onMenu({ x: event.clientX, y: event.clientY })
      }}
      aria-current={selected ? 'true' : undefined}
      className={`group relative grid h-10 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_3.5rem] items-center gap-x-3.5 border-b border-hairline pr-1.5 outline-none transition-colors duration-[var(--duration-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
        nested ? 'pl-[3.75rem]' : 'pl-9'
      } ${selected ? 'bg-accent-soft before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent' : 'hover:bg-surface'} ${
        contextOnly ? 'text-ink-tertiary' : ''
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {/* The dot is the colour control, as it was: what a category is drawn in
            is changed where it is drawn. The panel has the same choice, in the
            open. */}
        <AppearancePicker
          id={category.id}
          name={category.name}
          color={category.color}
          icon={category.icon}
          palette={palette}
          onChange={handlers.onSetAppearance}
        />

        {isEditing ? (
          <input
            autoFocus
            defaultValue={category.name}
            aria-label={`Rename ${category.name}`}
            onBlur={(event) => handlers.onRename(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') handlers.onRename(category.name)
            }}
            className={`${FIELD} h-7`}
          />
        ) : (
          <span className="flex min-w-0" style={{ color: category.isSystem ? undefined : undefined }}>
            <Bidi className="min-w-0 truncate">{category.name}</Bidi>
          </span>
        )}

        {category.isArchived && <Tag>archived</Tag>}
        {category.isSystem && <Tag>system</Tag>}
        {activity === undefined && !category.isSystem && (
          <span className="text-caption text-ink-tertiary">unused</span>
        )}
      </span>

      <span aria-hidden className="block">
        <span
          className="block h-1.5 transition-[width] duration-[var(--duration-base)]"
          style={{ width: `${month > 0 ? Math.max(3, Math.round((100 * month) / top)) : 0}%`, backgroundColor: colour }}
        />
      </span>

      <span className="text-right tabular-nums">
        {month > 0 ? whole(money(month, currency)) : <span className="text-ink-tertiary">—</span>}
      </span>

      <span className="flex justify-end gap-0.5 opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 group-focus-within:opacity-100">
        {!category.isSystem && (
          <button
            type="button"
            title="Rename (F2)"
            aria-label={`Rename ${category.name}`}
            onClick={(event) => {
              event.stopPropagation()
              handlers.onEdit()
            }}
            className="flex size-7 items-center justify-center text-ink-secondary hover:text-ink"
          >
            <ActionGlyph name="edit" size={14} />
          </button>
        )}
        <button
          type="button"
          title="More (right-click)"
          aria-label={`More for ${category.name}`}
          onClick={(event) => {
            event.stopPropagation()
            const box = event.currentTarget.getBoundingClientRect()
            handlers.onMenu({ x: box.right - 4, y: box.bottom + 2 })
          }}
          className="flex size-7 items-center justify-center text-ink-secondary hover:text-ink"
        >
          <ActionGlyph name="more" size={14} />
        </button>
      </span>
    </li>
  )
}

/**
 * **What one category holds** (choice 3 B): its year, the shops its money goes
 * to, the rules that file into it, its target and its colour — the facts that
 * decide whether it is worth keeping, in one place beside the list.
 *
 * The twelve bars end at the month shown, in the category's own colour, and the
 * last is full strength. The figures are the document's currency only and leave
 * out every row left out of the totals, so the panel and Home agree.
 */
function CategoryPanel({
  category,
  palette,
  currency,
  period,
  series,
  rules,
  merchants,
  onSetAppearance,
  budget,
  hasPlan,
  onSetTarget,
  parentPath,
  homes,
  onSetParent,
  onRename,
  onMerge,
  onDelete,
  onArchive,
  onShowRows,
  onRules,
}: {
  category: Category
  /** Its parent's path, when it has one. */
  parentPath: string | undefined
  /** Where it can go (`parentsFor`): its own kind, with room for what it carries. */
  homes: readonly Category[]
  onSetParent: (parentId: string | undefined) => void
  palette: CategoryPalette
  currency: string
  period: string | undefined
  series: readonly number[] | undefined
  rules: readonly { readonly id: string; readonly name: string }[]
  merchants: readonly { readonly merchantRaw: string; readonly count: number; readonly outflowMinor: number }[]
  onSetAppearance: (appearance: { color: string | undefined; icon: string | undefined }) => void
  budget: Money | undefined
  hasPlan: boolean
  onSetTarget: (target: Money | undefined) => void
  onRename: () => void
  onMerge: () => void
  onDelete: () => void
  onArchive: () => void
  onShowRows: () => void
  onRules: () => void
}) {
  const colour = palette.colorOf(category.id)
  const bars = series ?? Array.from({ length: YEAR }, () => 0)
  const month = bars.at(-1) ?? 0
  const peak = Math.max(1, ...bars)
  const average = Math.round(bars.reduce((sum, value) => sum + value, 0) / YEAR)
  const target = budget
  const over =
    target === undefined || target.minor === 0 || month === 0
      ? undefined
      : Math.round((100 * (month - target.minor)) / target.minor)
  const parsed = period === undefined ? undefined : parseYearMonth(period)
  const monthName = parsed === undefined ? 'The month' : formatMonthShort(parsed)

  return (
    <aside
      aria-label={`${category.name}, in detail`}
      className="fc-view-enter flex flex-col gap-3.5 border border-hairline p-[18px] @[56rem]:sticky @[56rem]:top-0"
    >
      <span className="fc-label flex min-w-0 text-ink-secondary uppercase">
        <Bidi className="min-w-0 truncate">{parentPath ?? 'Top level'}</Bidi>
      </span>
      <h3 className="m-0 text-[18px] font-medium">
        <CategoryMark color={colour}>{category.name}</CategoryMark>
      </h3>

      <div>
        <span className="fc-label text-ink-secondary uppercase">{monthName}</span>
        <div className="text-[26px] leading-tight font-medium tracking-[-0.01em] tabular-nums">
          {formatMoney(money(month, currency))}
        </div>
        <small className="text-caption text-ink-secondary">
          average {whole(money(average, currency))} a month over the year
        </small>
      </div>

      <div className="flex h-14 items-end gap-[3px]" role="img" aria-label="The last twelve months, oldest first">
        {bars.map((value, index) => (
          <i
            key={index}
            className="block flex-1"
            title={formatMoney(money(value, currency))}
            style={{
              height: `${value > 0 ? Math.max(4, Math.round((56 * value) / peak)) : 2}px`,
              backgroundColor: colour,
              opacity: index === bars.length - 1 ? 1 : 0.45,
            }}
          />
        ))}
      </div>

      <div>
        <span className="fc-label text-ink-secondary uppercase">Colour</span>
        <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`Colour of ${category.name}`}>
          {CATEGORY_COLOR_TOKENS.map((slot, index) => {
            const worn = palette.peersWearing(category.id, slot)
            const chosen = category.color === slot
            return (
              <button
                key={slot}
                type="button"
                aria-label={`Colour ${index + 1}${worn.length === 0 ? '' : `, also ${worn.join(', ')}`}`}
                aria-pressed={chosen}
                title={worn.length === 0 ? `Hue ${index + 1}` : `A sibling wears this: ${worn.join(', ')}`}
                onClick={() => onSetAppearance({ color: slot, icon: category.icon })}
                className={`flex size-[22px] items-center justify-center rounded-full border-2 ${chosen ? 'border-ink' : 'border-transparent'}`}
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
            aria-label="Automatic colour"
            aria-pressed={category.color === undefined}
            title="Automatic: a stable hue, moved aside when a sibling is already on it"
            onClick={() => onSetAppearance({ color: undefined, icon: category.icon })}
            className={`flex size-[22px] items-center justify-center rounded-full border-2 ${category.color === undefined ? 'border-ink' : 'border-transparent'}`}
          >
            <i className="block size-3.5 rounded-full border border-dashed border-ink-tertiary" />
          </button>
        </div>
      </div>

      {!category.isSystem && (
        <div>
          <span className="fc-label text-ink-secondary uppercase">Under</span>
          <div className="mt-1.5">
            {/* What the group select was (M28 F25): a heading is a top-level
                category now, so choosing one is choosing a parent (M28 F29). */}
            <select
              value={category.parentId ?? ''}
              onChange={(event) => onSetParent(event.target.value === '' ? undefined : event.target.value)}
              aria-label={`What ${category.name} sits under`}
              className={`${SELECT} w-full`}
            >
              <option value="">Top level</option>
              {homes.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.path}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <span className="fc-label text-ink-secondary uppercase">Where it goes</span>
        <div className="mt-1.5 flex flex-col">
          {merchants.length === 0 ? (
            <div className="flex h-[30px] items-center border-b border-hairline text-[13px] text-ink-secondary">
              Nothing in the last twelve months
            </div>
          ) : (
            merchants.map((one) => (
              <div
                key={one.merchantRaw}
                className="flex h-[30px] items-center justify-between gap-3 border-b border-hairline text-[13px]"
              >
                <span className="flex min-w-0">
                  <Bidi className="min-w-0 truncate">{one.merchantRaw}</Bidi>
                </span>
                <span className="text-ink-secondary tabular-nums">
                  {whole(money(one.outflowMinor, currency))}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {!category.isSystem && (
        <div>
          <span className="fc-label text-ink-secondary uppercase">Each month (Plan bucket)</span>
          <div className="mt-1.5 flex items-center gap-3">
            <MonthlyTarget category={category} budget={budget} currency={currency} onSet={onSetTarget} />
            {over !== undefined && (
              <span className="text-caption text-ink-secondary tabular-nums">
                {monthName} is {Math.abs(over)}% {over >= 0 ? 'over' : 'under'}
              </span>
            )}
          </div>
          <p className="mt-1 mb-0 text-caption text-ink-tertiary">
            {hasPlan
              ? 'The same figure as this category’s bucket on Plan; Home shows the month against it.'
              : 'Setting one starts a plan, with this as its bucket.'}
          </p>
        </div>
      )}

      <div>
        <span className="fc-label text-ink-secondary uppercase">Rules that categorize here · {rules.length}</span>
        <div className="mt-1.5 flex flex-col">
          {rules.length === 0 ? (
            <div className="flex h-[30px] items-center border-b border-hairline text-[13px] text-ink-secondary">
              None of yours yet
            </div>
          ) : (
            rules.slice(0, 5).map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={onRules}
                className="flex h-[30px] items-center justify-between gap-3 border-b border-hairline text-left text-[13px] hover:text-accent"
              >
                <span className="flex min-w-0">
                  <Bidi className="min-w-0 truncate">{rule.name}</Bidi>
                </span>
                <ActionGlyph name="right" size={12} />
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!category.isSystem && (
          <Button variant="secondary" size="sm" icon="edit" onClick={onRename}>
            Rename
          </Button>
        )}
        {!category.isSystem && (
          <Button variant="secondary" size="sm" icon="merge" onClick={onMerge}>
            Merge into…
          </Button>
        )}
        <Button variant="secondary" size="sm" icon="filter" onClick={onShowRows}>
          Its rows
        </Button>
        {!category.isSystem && (
          <Button variant="ghost" size="sm" onClick={onArchive}>
            {category.isArchived ? 'Restore' : 'Archive'}
          </Button>
        )}
        {!category.isSystem && (
          <Button variant="ghost" size="sm" icon="trash" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </aside>
  )
}

/**
 * Where this category sits — the reparent docs/f02 has listed as an operation
 * since M1 and which no screen has ever offered.
 *
 * **Same kind only, and within three levels** (M28 F29). `reparentCategory`
 * sets the parent and never the kind, and refuses one of another kind: an
 * INCOME category filed under an EXPENSE parent would roll up into a parent
 * that means the opposite. The list is `parentsFor`: its own kind, not itself
 * or anything under it, with room for what it carries.
 *
 * A panel rather than a select on the row, which is not only a DOM budget: a
 * reparent moves history as surely as a merge does, and the two operations
 * being told in the same voice, in the same place, is what stops one of them
 * looking like a setting.
 */
function MovePanel({
  source,
  parents,
  onCancel,
  onMove,
}: {
  source: Category
  parents: readonly Category[]
  onCancel: () => void
  onMove: (parentId: string | undefined) => void
}) {
  const eligible = parents
  const [parentId, setParentId] = useState(source.parentId ?? '')

  return (
    <div className="fc-pop-enter shrink-0 border-t border-hairline bg-surface px-6 py-4">
      <p>
        Move <Bidi className="font-medium">{source.name}</Bidi> somewhere else in the tree. Its
        transactions, rules, Plan buckets and subcategories come with it.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
          aria-label={`Parent of ${source.name}`}
          className={SELECT}
        >
          <option value="">top level</option>
          {eligible.map((parent) => (
            <option key={parent.id} value={parent.id}>
              under {parent.path}
            </option>
          ))}
        </select>

        <Button
          variant="primary"
          size="sm"
          disabled={parentId === (source.parentId ?? '')}
          onClick={() => onMove(parentId === '' ? undefined : parentId)}
        >
          Move
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {eligible.length === 0 && (
        <p className="mt-2 text-caption text-ink-tertiary">
          Nothing else that is {source.kind.toLowerCase().replace('_', ' ')} has room for it within three
          levels, so the only place this can go is the top level itself.
        </p>
      )}
    </div>
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
    <label className="flex items-center gap-2 text-caption text-ink-tertiary">
      <span className="sr-only">Plan bucket for {category.name}</span>
      <span aria-hidden>bucket</span>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setText(stored)
        }}
        placeholder="none"
        aria-label={`Plan bucket for ${category.name}`}
        className={`${FIELD} h-7 w-24 text-right tabular-nums`}
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
    <form onSubmit={submit} className="ml-auto flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New category"
        aria-label="New category name"
        className={`${FIELD} w-44`}
      />

      <ParentPicker parents={parents} value={parentId} onChange={setParentId} />

      {parentId === '' && (
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as CategoryKind)}
          aria-label="Category kind"
          className={SELECT}
        >
          {(['EXPENSE', 'INCOME', 'TRANSFER', 'SAVING', 'DEBT_PAYMENT'] as const).map((option) => (
            <option key={option} value={option}>
              {option.toLowerCase().replace('_', ' ')}
            </option>
          ))}
        </select>
      )}

      <Button variant="primary" size="sm" type="submit">
        Add
      </Button>
    </form>
  )
}

/**
 * Merge is the answer to most reasons someone wanted delete, so it says plainly
 * what it is about to do before it does it.
 */
function MergePanel({
  source,
  targets,
  onCancel,
  onMerge,
}: {
  source: Category
  targets: readonly Category[]
  onCancel: () => void
  onMerge: (intoId: string) => void
}) {
  const [intoId, setIntoId] = useState('')

  return (
    <div className="fc-pop-enter shrink-0 border-t border-hairline bg-surface px-6 py-4">
      <p>
        Merge <Bidi className="font-medium">{source.name}</Bidi> into another category. Every
        transaction moves across, subcategories come with it, and nothing is lost.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={intoId}
          onChange={(event) => setIntoId(event.target.value)}
          aria-label="Merge into"
          className={SELECT}
        >
          <option value="">Choose a category…</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.path}
            </option>
          ))}
        </select>

        <Button variant="primary" size="sm" disabled={intoId === ''} onClick={() => onMerge(intoId)}>
          Merge
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * A delete of a category something still uses (M28 F18, D-340): it says what
 * moves, and to where, before it does it. The targets are the repository's —
 * the same kind, live, with room for any subcategories it carries (M28 F29).
 */
function DeletePanel({
  source,
  using,
  targets,
  onCancel,
  onDelete,
}: {
  source: Category
  using: string
  targets: readonly Category[]
  onCancel: () => void
  onDelete: (moveTo: string) => void
}) {
  const [moveTo, setMoveTo] = useState('')

  return (
    <div className="fc-pop-enter shrink-0 border-t border-hairline bg-surface px-6 py-4">
      <p>
        Delete <Bidi className="font-medium">{source.name}</Bidi>. It still has {using}; they move to the category
        you choose, then it goes. Rows you categorized by hand stay categorized by hand.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={moveTo}
          onChange={(event) => setMoveTo(event.target.value)}
          aria-label="Move them to"
          className={SELECT}
          autoFocus
        >
          <option value="">Move them to…</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.path}
            </option>
          ))}
        </select>

        <Button variant="primary" size="sm" icon="trash" disabled={moveTo === ''} onClick={() => onDelete(moveTo)}>
          Move and delete
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Metadata, not a badge (docs/11): a quiet caption, no pill and no border. */
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-caption tracking-wide text-ink-tertiary uppercase">{children}</span>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
