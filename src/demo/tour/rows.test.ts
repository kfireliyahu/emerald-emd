import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '@/data/db/database.ts'
import { joinParts } from '@/domain/format/document.ts'
import { PACE } from './player.ts'
import { toursFrom } from './rows.ts'
import { chatUpTo, readingTime, scenesOf, type Tour } from './steps.ts'

/**
 * The tours as the demo reads them (M33 U3): the committed `.format.md` files,
 * rows and all, put together as `scripts/make-demo-document.mjs` puts them —
 * the two parts of a text document at this build's schema — and read through
 * the engine.
 */
const DEMO = new URL('../../../fixtures/synthetic/demo/', import.meta.url)

function toursText(parts: Record<string, string>): string {
  const joined = joinParts(Object.entries(parts).map(([name, text]) => ({ name, text })))
  if (!joined.ok) throw new Error(joined.error)
  return `<!-- emerald document, schema ${String(SCHEMA_VERSION)} -->\n${joined.value}`
}

const committed = {
  'tour.format.md': readFileSync(new URL('tour.format.md', DEMO), 'utf8'),
  'tour_step.format.md': readFileSync(new URL('tour_step.format.md', DEMO), 'utf8'),
}

async function read(parts: Record<string, string>): Promise<readonly Tour[]> {
  return toursFrom(new TextEncoder().encode(toursText(parts)))
}

describe('a tour is rows of a declared format (M33 U3)', () => {
  it('reads every step in position order, whatever order the text holds them in', async () => {
    const shuffled = committed['tour_step.format.md'].replace(
      /(### nav-formats-card_charge\n(?:[a-z_]+: .*\n)+)\n(### nav-formats\n(?:[a-z_]+: .*\n)+)/,
      '$2\n$1',
    )
    expect(shuffled).not.toBe(committed['tour_step.format.md'])
    const [tour] = await read({ ...committed, 'tour_step.format.md': shuffled })
    expect(tour?.steps.slice(0, 2).map((step) => step.anchor)).toEqual(['nav-formats-card_charge', 'nav-formats'])
  })

  it('refuses a step with an action the runner has not got, before anything plays', async () => {
    const wrong = committed['tour_step.format.md'].replace('action: click', 'action: hover')
    await expect(read({ ...committed, 'tour_step.format.md': wrong })).rejects.toThrow(/hover/)
  })

  it('refuses a type with nothing to type', async () => {
    const wrong = committed['tour_step.format.md'].replace('value: Receipt\n', '')
    await expect(read({ ...committed, 'tour_step.format.md': wrong })).rejects.toThrow()
  })

  it('refuses a tour whose first step says nothing', async () => {
    const wrong = committed['tour_step.format.md'].replace(
      'caption: Here is the card statement. One of these is the grocery store.\n',
      '',
    )
    await expect(read({ ...committed, 'tour_step.format.md': wrong })).rejects.toThrow(/starts with a caption/)
  })
})

describe('the custom tour', () => {
  let tour: Tour
  beforeAll(async () => {
    const tours = await read(committed)
    // The custom tour stays first: it is what `?tour=` falls back to (D-418).
    expect(tours.map((each) => each.name)).toEqual(['custom', 'development', 'ledger', 'timesheet'])
    tour = tours[0] as Tour
  })
  const scenes = () => scenesOf(tour.steps)

  it('opens on the question a visitor has, and names its own document (2026-10-07)', () => {
    expect(tour.title).toBe('Did the card charge what the receipt says?')
    expect(tour.description).toBe(
      'You kept the receipt from the grocery store. The card statement came in. Do they agree?',
    )
    expect(tour.document).toBe('custom.emd')
  })

  it('answers the question in its failure caption', () => {
    const failure = scenes().find((scene) => /12\.00 more/.test(scene.caption))
    expect(failure?.caption).toBe("They don't: the card was charged 12.00 more than the receipt says.")
    for (const scene of scenes()) expect(scene.caption).not.toMatch(/overcharg/i)
  })

  it('outlines only where the story needs the eye, not on every row', () => {
    const outlined = tour.steps.filter((step) => step.highlight !== undefined)
    expect(outlined.length).toBeGreaterThan(0)
    expect(outlined.length).toBeLessThanOrEqual(scenes().length / 2)
  })

  it('is five captions: the sixth, an invitation, had no point (M33 F1)', () => {
    expect(scenes().length).toBe(5)
  })

  it('reaches its last caption in under 80 s at 1x, and under a minute at 1.5x', () => {
    // Each caption read, capped, before its first action, the ring's travel
    // inside that (M33 F1); each other anchored row a travel, a beat after
    // it, and its characters typed. The last caption's own hold is the loop's
    // and is not counted.
    let ms = 0
    tour.steps.forEach((step, index) => {
      const last = index === tour.steps.length - 1
      const reads = step.caption !== undefined && !last
      if (reads) ms += Math.max(Math.min(readingTime(step.caption ?? ''), PACE.read), PACE.lead + PACE.travel)
      if (step.anchor !== undefined && !reads) ms += PACE.travel
      if (step.action === 'type') ms += (step.value ?? '').length * PACE.key
      if (!last && step.action !== 'say') ms += PACE.beat
    })
    expect(ms).toBeLessThan(80_000)
    expect(ms / 1.5).toBeLessThan(60_000)
  })

  it('has no caption about a minus: the charge is stored as what was charged', () => {
    for (const scene of scenes()) expect(scene.caption).not.toMatch(/minus|negative/i)
    const check = tour.steps.find((step) => step.anchor === 'claim-holds')
    expect(check?.value).toBe('total = paid_with.amount')
  })

  it('ends on the answer, so the loop holds it before starting over (P5, M33 F1)', () => {
    expect(scenes().at(-1)?.caption).toBe("They don't: the card was charged 12.00 more than the receipt says.")
    expect(tour.steps.at(-1)?.highlight).toBe('verdict-total_adds_up')
  })

  it('never names the Try it button, which a movie has not got', () => {
    for (const scene of scenes()) expect(scene.caption, scene.caption).not.toMatch(/try it/i)
  })

  it('shows the paper beside the app only while it is being typed in', () => {
    const shown = scenes().filter((scene) => scene.beside !== undefined).map((scene) => scene.caption)
    expect(shown.length).toBeGreaterThan(0)
    for (const caption of shown) expect(caption).not.toMatch(/read|scan/i)
  })

  it('names no anchor the app does not carry', () => {
    // The anchors the app's elements carry (M33 U2). A tour naming another one
    // stalls in the browser, where `check-tours` replays it; this catches a typo here.
    const carried = [
      /^nav-(formats|connections|formats-[a-z_]+)$/,
      /^new-format$/,
      /^door-empty$/,
      /^format-title$/,
      /^add-columns$/,
      /^column-(name|min|max)$/,
      /^type-(text|date|money|integer|link)$/,
      /^points-at$/,
      /^add-column$/,
      /^create-format$/,
      /^save-shape$/,
      /^(has-many|belongs-to|bubble)-[a-z_]+$/,
      /^total-(kind|of)$/,
      /^connection-save$/,
      /^claims$/,
      /^claim-[a-z_]+$/,
      /^add-(claim|computed)$/,
      /^foot-[a-z_]+(-currency)?$/,
      /^field-[a-z_]+$/,
      /^verdict-[a-z_]+$/,
      /^refusal$/,
      /^row-open$/,
      /^link-[a-z_]+$/,
      /^links-here-[a-z_]+-[a-z_]+$/,
      /^choice:/,
      /^row:/,
    ]
    for (const step of tour.steps) {
      for (const anchor of [step.anchor, step.highlight]) {
        if (anchor !== undefined) expect(carried.some((each) => each.test(anchor)), anchor).toBe(true)
      }
    }
  })
})

describe('the development tour, as a conversation (M33 F5)', () => {
  let tour: Tour
  beforeAll(async () => {
    const tours = await read(committed)
    tour = tours.find((each) => each.name === 'development') as Tour
  })
  const scenes = () => scenesOf(tour.steps)

  it('says an answer rather than asking, over a project of its own', () => {
    expect(tour.title).toBe('Ask for a feature. The project answers first.')
    expect(tour.document).toBe('project.emd')
  })

  it('is four captions and six chat lines, and no row brings more than one of each', () => {
    expect(scenes().length).toBe(4)
    expect(tour.steps.filter((step) => step.chat !== undefined).length).toBe(6)
    for (const step of tour.steps) if (step.chat !== undefined) expect(step.from).toBeDefined()
  })

  it('opens with the person asking, and the model answers from D-4', () => {
    const lines = chatUpTo(tour.steps, tour.steps.length - 1)
    expect(lines[0]?.from).toBe('person')
    expect(lines[1]?.from).toBe('model')
    expect(lines[1]?.chat).toMatch(/D-4/)
    expect(tour.steps.some((step) => step.highlight === 'row:D-4')).toBe(true)
  })

  it('writes the decision, the milestone and its units as record_format_rows would be handed them', () => {
    const writes = tour.steps.flatMap((step) => (step.write === undefined || 'declare' in step.write ? [] : [step.write]))
    expect(writes.map((each) => each.format)).toEqual(['decision', 'milestone', 'unit'])
    expect(writes[0]?.rows[0]?.['ref']).toBe('D-5')
    expect(writes[2]?.rows.map((row) => row['ref'])).toEqual(['M4 U1', 'M4 U2'])
    // The model writes; the ring, which is a person's hand, is not on it.
    for (const step of tour.steps) if (step.action === 'write') expect(step.anchor).toBeUndefined()
  })

  it('refuses a write that is not a format and its rows, before anything plays', async () => {
    const wrong = committed['tour_step.format.md'].replace('value: {"format": "milestone"', 'value: {"table": "milestone"')
    expect(wrong).not.toBe(committed['tour_step.format.md'])
    await expect(read({ ...committed, 'tour_step.format.md': wrong })).rejects.toThrow(/names a format and its rows/)
  })

  it('refuses a chat line that does not say whose it is', async () => {
    const wrong = committed['tour_step.format.md'].replace('chat: Fair. What rename does D-4 allow?\nfrom: person\n', 'chat: Fair. What rename does D-4 allow?\n')
    expect(wrong).not.toBe(committed['tour_step.format.md'])
    await expect(read({ ...committed, 'tour_step.format.md': wrong })).rejects.toThrow(/says who it is from/)
  })

  it('ends on the roadmap with M4 U1, and holds it', () => {
    expect(tour.steps.at(-1)?.action).toBe('say')
    expect(tour.steps.at(-1)?.highlight).toBe('line-M4 U1')
  })

  it('reaches its last caption in under a minute at 1x', () => {
    let ms = 0
    tour.steps.forEach((step, index) => {
      const last = index === tour.steps.length - 1
      const fresh = [step.caption, step.chat].filter((each) => each !== undefined).join(' ')
      const reads = fresh !== '' && !last
      if (reads) ms += Math.max(readingTime(fresh), step.anchor === undefined ? 0 : PACE.lead + PACE.travel)
      if (step.anchor !== undefined && !reads) ms += PACE.travel
      if (step.action === 'write') ms += PACE.lead
      if (!last && step.action !== 'say') ms += PACE.beat
    })
    expect(ms).toBeLessThan(60_000)
  })

  it('names no anchor the app does not carry', () => {
    const carried = [
      /^nav-formats-[a-z_]+(-(board|roadmap|ready))?$/,
      /^line-M\d+ U\d+$/,
      /^roadmap-M\d+$/,
      /^row:/,
    ]
    for (const step of tour.steps) {
      for (const anchor of [step.anchor, step.highlight]) {
        if (anchor !== undefined) expect(carried.some((each) => each.test(anchor)), anchor).toBe(true)
      }
    }
  })
})

describe('the timesheet tour, on top of the ledger (M33 U7)', () => {
  let tour: Tour
  beforeAll(async () => {
    const tours = await read(committed)
    tour = tours.find((each) => each.name === 'timesheet') as Tour
  })
  const scenes = () => scenesOf(tour.steps)

  it('opens on the question over a ledger of its own, and ends on its answer', () => {
    expect(tour.title).toBe('Was every hour I worked paid?')
    expect(tour.document).toBe('timesheet.emd')
    expect(scenes().at(-1)?.caption).toMatch(/Every hour was paid/)
    expect(tour.steps.at(-1)?.highlight).toBe('verdict-hours_paid')
  })

  it('is six captions, and the claim is outlined on each of its three verdicts', () => {
    expect(scenes()).toHaveLength(6)
    const outlined = scenes().filter((scene) => tour.steps[scene.last]?.highlight === 'verdict-hours_paid')
    expect(outlined.map((scene) => scene.caption)).toEqual([
      expect.stringMatching(/unchecked/),
      expect.stringMatching(/fails/),
      expect.stringMatching(/was paid/),
    ])
  })

  it('declares the timesheet in its own words and adds to the paycheck no column', () => {
    const declares = tour.steps.flatMap((step) => (step.write !== undefined && 'declare' in step.write ? [step.write.declare] : []))
    expect(declares.map((each) => each.format)).toEqual(['timesheet_day', 'paycheck'])
    // A real timesheet's shape: one row per day, hours and the day's earning worked out.
    expect(declares[0]?.columns?.map((each) => `${each.name}:${each.type}`)).toEqual([
      'date:date',
      'start:time',
      'end:time',
      'rate:money',
      'paycheck:link',
    ])
    expect(declares[0]?.computed?.map((each) => `${each.name} = ${each.works_out}`)).toEqual(['hours = end - start', 'earned = hours * rate'])
    expect(declares[0]?.columns?.find((each) => each.name === 'paycheck')?.found_by).toBe('date in period')
    expect(declares[1]?.columns).toBeUndefined()
    expect(declares[1]?.claims?.map((each) => each.expression)).toEqual(['gross = worked'])
  })

  it('reaches its last caption in under 80 s at 1x', () => {
    let ms = 0
    tour.steps.forEach((step, index) => {
      const last = index === tour.steps.length - 1
      const fresh = [step.caption, step.chat].filter((each) => each !== undefined).join(' ')
      const reads = fresh !== '' && !last
      if (reads) ms += Math.max(Math.min(readingTime(fresh), PACE.read), step.anchor === undefined ? 0 : PACE.lead + PACE.travel)
      if (step.anchor !== undefined && !reads) ms += PACE.travel
      if (step.action === 'type') ms += (step.value ?? '').length * PACE.key
      if (step.action === 'write') ms += PACE.lead
      if (!last && step.action !== 'say') ms += PACE.beat
    })
    expect(ms).toBeLessThan(80_000)
  })

  it('names no anchor the app does not carry', () => {
    const carried = [
      /^nav-(paychecks|formats|formats-[a-z_]+)$/,
      /^foot-[a-z_]+$/,
      /^field-[a-z_]+$/,
      /^link-[a-z_]+$/,
      /^verdict-[a-z_]+$/,
      /^row:/,
    ]
    for (const step of tour.steps) {
      for (const anchor of [step.anchor, step.highlight]) {
        if (anchor !== undefined) expect(carried.some((each) => each.test(anchor)), anchor).toBe(true)
      }
    }
  })
})
