import { money, type Money } from '@/core/money.ts'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { MonthFlow } from '@/ui/charts/MonthFlow.tsx'
import { MonthStrip, type StripMonth } from '@/ui/charts/MonthStrip.tsx'
import { MonthTrend, type TrendMonth } from '@/ui/charts/MonthTrend.tsx'
import { PartOfWhole } from '@/ui/charts/PartOfWhole.tsx'
import { PlanAgainst } from '@/ui/charts/PlanAgainst.tsx'
import { RankedBars, type RankedRow } from '@/ui/charts/RankedBars.tsx'
import { Sparkline } from '@/ui/charts/Sparkline.tsx'
import { shortText } from '@/ui/charts/chart.ts'
import { DISPLAYS, wholeMoney } from '@/ui/charts/kit.ts'
import { Amount } from '@/ui/components/Amount.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState, WaitingList } from '@/ui/components/WaitingList.tsx'
import { Working } from '@/ui/components/Working.tsx'

import type { Specimen } from './Specimen.tsx'

/**
 * **What the specimen page draws** (M64 U4, D-615): every shared component and
 * every display of the kit, each in the states it has — at rest, empty,
 * partial, negative, and with long Hebrew labels — light and dark side by side
 * (`Specimen.tsx`). The figures are invented for the page and are no one's.
 */

const ils = (major: number): Money => money(Math.round(major * 100), 'ILS')
const noop = () => undefined
const whole = (value: number) => wholeMoney(ils(value))
const compact = (value: number) => shortText(value, { currency: 'ILS' })

const MONTHS = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const YEARS = [2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2026, 2026, 2026]
const LONG = ['February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March']
const months = (count: number, running = false): TrendMonth[] =>
  MONTHS.slice(-count).map((label, index, all) => ({
    key: `${String(YEARS[14 - count + index])}-${label}`,
    label,
    long: `${LONG[14 - count + index]!} ${String(YEARS[14 - count + index])}`,
    running: running && index === all.length - 1,
  }))

const CAME = [18400, 18400, 19100, 18400, 18400, 22900, 18400, 18400, 18900, 18400, 18400, 19600, 18400, 6200]
const WENT = [15200, 16900, 14800, 17300, 15600, 21400, 16100, 14900, 15800, 19800, 16400, 15100, 15900, 9800]
const LEFT = CAME.map((value, index) => value - WENT[index]!)

const strip = (values: readonly (number | undefined)[], running = false): StripMonth[] =>
  months(values.length, running).map((month, index) => ({
    ...month,
    value: values[index],
    ...(index === 4 ? { note: 'a statement is missing' } : {}),
  }))

const RANKED: RankedRow[] = [
  { key: 'groceries', name: 'Groceries', value: ils(3120.4), hue: 'category-1' },
  { key: 'home', name: 'Home', value: ils(2480), hue: 'category-2' },
  { key: 'car', name: 'Car', value: ils(1310.9), hue: 'category-3' },
  { key: 'eating', name: 'Eating out', value: ils(960), hue: 'category-4' },
  { key: 'health', name: 'Health', value: ils(540.5), hue: 'category-5' },
  { key: 'kids', name: 'Kids', value: ils(420), hue: 'category-6' },
  { key: 'gifts', name: 'Gifts', value: ils(210), hue: 'category-7' },
  { key: 'books', name: 'Books', value: ils(88), hue: 'category-8' },
  { key: 'none', name: 'Uncategorized', value: ils(640), hue: 'category-none', note: '· 4 rows' },
]
const HEBREW: RankedRow[] = [
  { key: 'a', name: 'סופרמרקט השכונה הגדול שבקצה הרחוב הארוך', value: ils(2310), hue: 'category-1' },
  { key: 'b', name: 'תחנת הדלק שליד היציאה מהעיר', value: ils(890), hue: 'category-3' },
  { key: 'c', name: 'קופת חולים — השתתפות עצמית', value: ils(212.4), hue: 'category-5' },
]

export const SPECIMENS: readonly Specimen[] = [
  {
    name: DISPLAYS[0]!.name,
    about: `${DISPLAYS[0]!.shape}. ${DISPLAYS[0]!.use}`,
    states: [
      { name: 'Display', render: () => <HeadlineFigure size="display" label="Left over" value={ils(2840.4)} change="+18% on the three months before" empty="" /> },
      {
        name: 'Tiles, one opens',
        render: () => (
          <div className="grid grid-cols-2 gap-6">
            <HeadlineFigure label="Came in" mark="flow-in" value={ils(18400)} change="Same as the three months before" trend={CAME.slice(-8)} empty="" onOpen={noop} />
            <HeadlineFigure label="Went out" mark="flow-out" value={ils(15560)} change="−6% on the three months before" trend={WENT.slice(-8)} empty="" />
          </div>
        ),
      },
      { name: 'Empty', render: () => <HeadlineFigure label="Taxes" value={undefined} empty="No paycheck this month" /> },
      { name: 'Negative', render: () => <HeadlineFigure size="display" label="Left over" value={ils(-1240.75)} change="₪1,241 more went out than came in" empty="" /> },
      { name: 'Summing a period up, by its sign (D-633)', render: () => <HeadlineFigure size="display" tone="sign" label="Left over" value={ils(2840.4)} change="+18% on the three months before" empty="" /> },
      { name: 'Summing a period up, below nothing', render: () => <HeadlineFigure size="display" tone="sign" label="Left over" value={ils(-1240.75)} change="₪1,241 more went out than came in" empty="" /> },
      { name: 'A gap', render: () => <HeadlineFigure tone="gap" label="Apart" value={ils(118.2)} empty="" /> },
      { name: 'Long Hebrew', render: () => <HeadlineFigure label="נשאר אחרי כל ההוצאות, החיסכון והתשלומים הקבועים" value={ils(912)} change="+4% לעומת שלושת החודשים הקודמים" empty="" /> },
    ],
  },
  {
    name: DISPLAYS[1]!.name,
    about: `${DISPLAYS[1]!.shape}. ${DISPLAYS[1]!.use}`,
    states: [
      { name: 'Rest', render: () => <Sparkline values={WENT.slice(-12)} /> },
      { name: 'Partial', render: () => <Sparkline values={[undefined, 400, 380, undefined, 520, 610]} /> },
      { name: 'Empty (draws nothing)', render: () => <Sparkline values={[1200]} /> },
      { name: 'Negative', render: () => <Sparkline values={LEFT.slice(-10).map((value) => value - 3000)} /> },
    ],
  },
  {
    name: DISPLAYS[2]!.name,
    about: `${DISPLAYS[2]!.shape}. ${DISPLAYS[2]!.use}`,
    states: [
      { name: 'Rest, the rest folded (it grows in place)', render: () => <RankedBars rows={RANKED} empty="" total={{ label: 'Went out', value: ils(9769.8) }} onOpen={noop} /> },
      { name: 'Empty', render: () => <RankedBars rows={[]} empty="Nothing went out this month." /> },
      {
        name: 'Negative',
        render: () => <RankedBars rows={[{ key: 'shop', name: 'Clothes', value: ils(820), hue: 'category-9' }, { key: 'back', name: 'Returns', value: ils(-310), hue: 'category-10', note: '· money back' }]} empty="" />,
      },
      { name: 'Long Hebrew', render: () => <RankedBars rows={HEBREW} empty="" onOpen={noop} /> },
    ],
  },
  {
    name: DISPLAYS[3]!.name,
    about: `${DISPLAYS[3]!.shape}. ${DISPLAYS[3]!.use}`,
    states: [
      {
        name: 'Rest',
        render: () => (
          <PartOfWhole
            label="Saved"
            empty=""
            parts={[
              { key: 'pension', name: 'Pension', value: ils(1840), hue: 'category-10', note: 'off the slip' },
              { key: 'study', name: 'Study fund', value: ils(760), hue: 'category-3', note: 'off the slip' },
              { key: 'goal', name: 'Holiday', value: ils(500), hue: 'category-2', note: 'into a goal' },
            ]}
          />
        ),
      },
      { name: 'Empty', render: () => <PartOfWhole label="Saved" parts={[]} empty="Nothing was put aside this month." /> },
      {
        name: 'Negative',
        render: () => (
          <PartOfWhole
            label="Saved"
            empty=""
            parts={[
              { key: 'pension', name: 'Pension', value: ils(1840), hue: 'category-10' },
              { key: 'goal', name: 'Car fund', value: ils(-2000), hue: 'category-2', note: 'taken out' },
            ]}
          />
        ),
      },
      {
        name: 'Long Hebrew',
        render: () => (
          <PartOfWhole label="חיסכון" empty="" parts={[{ key: 'a', name: 'קרן השתלמות דרך המעסיק הנוכחי', value: ils(760), hue: 'category-3' }, { key: 'b', name: 'פנסיה', value: ils(1840), hue: 'category-10' }]} />
        ),
      },
    ],
  },
  {
    name: DISPLAYS[4]!.name,
    about: `${DISPLAYS[4]!.shape}. ${DISPLAYS[4]!.use}`,
    states: [
      {
        name: 'Rest, one over',
        render: () => (
          <PlanAgainst
            onOpen={noop}
            empty=""
            lines={[
              { key: 'groceries', name: 'Groceries', actual: ils(3120), planned: ils(3500) },
              { key: 'eating', name: 'Eating out', actual: ils(960), planned: ils(700) },
              { key: 'car', name: 'Car', actual: ils(1310), planned: ils(1400) },
            ]}
          />
        ),
      },
      { name: 'Empty', render: () => <PlanAgainst lines={[]} empty="Nothing is planned for this month." /> },
      {
        name: 'Partial and negative',
        render: () => (
          <PlanAgainst
            empty=""
            lines={[
              { key: 'gifts', name: 'Gifts', actual: ils(210), planned: undefined },
              { key: 'back', name: 'Clothes', actual: ils(-120), planned: ils(400) },
            ]}
          />
        ),
      },
      {
        name: 'Past the plan, a little and twice over (M64 F32)',
        render: () => (
          <PlanAgainst
            empty=""
            lines={[
              { key: 'groceries', name: 'Groceries', actual: ils(3675), planned: ils(3500) },
              { key: 'eating', name: 'Eating out', actual: ils(1490), planned: ils(700) },
              { key: 'loan', name: 'Car loan', actual: ils(2400), planned: ils(1200), note: 'Paid twice its month' },
              { key: 'trip', name: 'Trip', actual: ils(5000), planned: ils(5000), note: 'Reached' },
            ]}
          />
        ),
      },
      { name: 'Long Hebrew', render: () => <PlanAgainst empty="" lines={[{ key: 'a', name: 'קניות בסופרמרקט ובשוק בסוף השבוע', actual: ils(2900), planned: ils(2600) }]} /> },
    ],
  },
  {
    name: DISPLAYS[5]!.name,
    about: `${DISPLAYS[5]!.shape}. ${DISPLAYS[5]!.use}`,
    states: [
      {
        name: 'Rest, the month running',
        render: () => (
          <MonthTrend
            months={months(14, true)}
            series={[
              { key: 'in', name: 'Came in', values: CAME, hue: 'flow-in' },
              { key: 'out', name: 'Went out', values: WENT, hue: 'flow-out' },
            ]}
            open={12}
            label="Came in and went out, by month"
            empty=""
            format={whole}
            tick={compact}
            onOpen={noop}
          />
        ),
      },
      { name: 'Empty', render: () => <MonthTrend months={[]} series={[]} label="By month" empty="No month has anything in it yet." format={whole} tick={compact} /> },
      {
        name: 'Partial',
        render: () => <MonthTrend months={months(6)} series={[{ key: 'left', name: 'Left over', values: [undefined, undefined, 2400, 3100, undefined, 1800] }]} label="Left over, by month" empty="" format={whole} tick={compact} />,
      },
      {
        name: 'Negative',
        render: () => <MonthTrend months={months(14)} series={[{ key: 'left', name: 'Left over', values: LEFT.map((value) => value - 2500) }]} label="Left over, by month" empty="" format={whole} tick={compact} />,
      },
    ],
  },
  {
    name: DISPLAYS[6]!.name,
    about: `${DISPLAYS[6]!.shape}. ${DISPLAYS[6]!.use}`,
    states: [
      { name: 'Rest, the month running', render: () => <MonthStrip months={strip(LEFT, true)} open={12} label="Left over, by month" empty="" format={whole} onOpen={noop} /> },
      { name: 'Empty', render: () => <MonthStrip months={[]} open={0} label="Left over, by month" empty="No month has anything in it yet." format={whole} onOpen={noop} /> },
      { name: 'Partial', render: () => <MonthStrip months={strip([undefined, undefined, undefined, 2400, 3100, 1800])} open={5} label="Left over, by month" empty="" format={whole} onOpen={noop} /> },
      { name: 'Negative', render: () => <MonthStrip months={strip(LEFT.map((value) => value - 2500))} open={9} label="Left over, by month" empty="" format={whole} onOpen={noop} /> },
    ],
  },
  {
    name: DISPLAYS[7]!.name,
    about: `${DISPLAYS[7]!.shape}. ${DISPLAYS[7]!.use}`,
    states: [
      {
        name: 'Rest',
        render: () => (
          <MonthFlow
            whole={{ label: 'Came in', value: ils(18400) }}
            parts={[
              { key: 'spent', label: 'Spent', value: ils(12460) },
              { key: 'aside', label: 'Put aside', value: ils(3100), hue: 'flow-saved' },
            ]}
            left="Left over"
            empty=""
          />
        ),
      },
      { name: 'Empty', render: () => <MonthFlow whole={{ label: 'Came in', value: ils(0) }} parts={[]} left="Left over" empty="Nothing came in or went out this month." /> },
      {
        name: 'Negative, more went than came',
        render: () => (
          <MonthFlow
            whole={{ label: 'Came in', value: ils(6200) }}
            parts={[
              { key: 'spent', label: 'Spent', value: ils(7400) },
              { key: 'aside', label: 'Put aside', value: ils(1000), hue: 'flow-saved' },
            ]}
            left="Left over"
            empty=""
          />
        ),
      },
      {
        name: 'Long Hebrew',
        render: () => (
          <MonthFlow
            whole={{ label: 'ברוטו לפי התלוש', value: ils(24300) }}
            parts={[
              { key: 'tax', label: 'מס הכנסה וביטוח לאומי', value: ils(5200) },
              { key: 'pension', label: 'הפרשה לפנסיה ולקרן השתלמות', value: ils(2600), hue: 'flow-saved' },
            ]}
            left="נטו"
            empty=""
          />
        ),
      },
    ],
  },
  {
    name: 'WaitingList',
    about: 'What is waiting, as one quiet list below the answer: the finding, why it matters, one verb (D-614, from C).',
    states: [
      {
        name: 'Rest',
        render: () => (
          <WaitingList
            label="Waiting"
            items={[
              { key: 'uncat', say: '3 charges have no category', why: 'They change this month’s totals.', verb: 'Answer them', onDo: noop },
              { key: 'bill', say: 'A bill looks like it repeats', why: 'Electricity, every two months.', verb: 'Track it', onDo: noop },
            ]}
          />
        ),
      },
      { name: 'Empty (draws nothing)', render: () => <WaitingList label="Waiting" items={[]} /> },
      { name: 'Long Hebrew', render: () => <WaitingList label="ממתין" items={[{ key: 'a', say: 'שלושה חיובים מחנות הספרים בקניון עדיין בלי קטגוריה', verb: 'מענה', onDo: noop }]} /> },
    ],
  },
  {
    name: 'SidePanel',
    about: 'Detail beside the page: a figure’s breakdown or a category’s rows, without leaving the month (D-614, from A). Here docked; under 1360px it floats.',
    states: [
      {
        name: 'Rest',
        render: () => (
          <div className="fc-side-panel-docked">
            <SidePanel kicker="March 2026" title="Groceries" onClose={noop}>
              <HeadlineFigure label="Went out on groceries" value={ils(3120.4)} change="14 rows · 32% of what went out" empty="" />
            </SidePanel>
          </div>
        ),
      },
      {
        name: 'Long Hebrew',
        render: () => (
          <div className="fc-side-panel-docked">
            <SidePanel kicker="מרץ 2026" title="סופרמרקט השכונה הגדול שבקצה הרחוב הארוך" onClose={noop}>
              <EmptyState say="אין עוד שורות בחודש הזה." />
            </SidePanel>
          </div>
        ),
      },
    ],
  },
  {
    name: 'EmptyState',
    about: 'One sentence in ink-secondary and at most one text action, no illustration.',
    states: [
      { name: 'Rest', render: () => <EmptyState say="Nothing is planned for this month." verb="Make a plan" onDo={noop} /> },
      { name: 'Long Hebrew', render: () => <EmptyState say="אין עדיין חודשים במסמך הזה — קריאת דף חשבון תיצור את הראשון." verb="קריאת קבצים" onDo={noop} /> },
    ],
  },
  {
    name: 'Button',
    about: 'One primary per screen; a button with an icon is a split tile.',
    states: [
      {
        name: 'Rest',
        render: () => (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon="read">Read files</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="ghost">More</Button>
          </div>
        ),
      },
      {
        name: 'Busy and counted',
        render: () => (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon="read" busy="Reading">Read files</Button>
            <Button variant="secondary" icon="check" count={3}>Answer</Button>
          </div>
        ),
      },
      { name: 'Long Hebrew', render: () => <div className="flex"><Button variant="secondary" icon="read">קריאת דפי חשבון ותלושי שכר</Button></div> },
    ],
  },
  {
    name: 'Chip, Amount, IconAction, Working',
    about: 'The small pieces: a chip is text and a dot; an amount keeps its minus; an icon action is 16px on a 28px target; one progress indicator.',
    states: [
      {
        name: 'Rest',
        render: () => (
          <div className="flex flex-wrap items-center gap-4">
            <Chip>Read</Chip>
            <Chip problem>A statement is missing</Chip>
            <Amount value={ils(1234.5)} />
            <Amount value={ils(-87.2)} />
            <IconAction label="Delete" tone="negative" onClick={noop}>
              <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
            </IconAction>
            <Working label="Working" />
          </div>
        ),
      },
      { name: 'Long Hebrew', render: () => <Chip problem>חסר דף חשבון של כרטיס האשראי לחודש הזה</Chip> },
    ],
  },
]
