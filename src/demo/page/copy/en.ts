import type { Copy } from '../copy.ts'

/**
 * **Emerald's page, in English — every word of it** (M33 F9). The
 * words, approved on the mockup (M33 U8a) and the maintainer's to change here: edit a
 * string, and the page shows it. `{slots}` are links the markup provides and
 * stay as they are. Another language is a copy of this file, translated, added
 * to `LANGUAGES` in `../copy.ts`.
 *
 * Two lines are not this page's own: `hero.tagline` is the README's first
 * line, and `words.local.body` says what the personal site says (D-459) —
 * "sends nothing anywhere itself", never "your data never leaves it".
 */
export const en: Copy = {
  lang: 'en',
  dir: 'ltr',
  name: 'English',
  title: 'Emerald',
  description: 'Emerald: Order to chaos using engineering',

  rail: {
    roadmap: 'The page, as a roadmap',
    theme: { toLight: 'Switch to light', toDark: 'Switch to dark' },
    language: 'Language',
    free: 'Free software, AGPL-3.0.',
    source: 'Source',
    privacy: 'Privacy',
  },

  rows: {
    story: 'What it is',
    receipt: 'The receipt',
    'ledger-tour': 'Where the money went',
    'development-tour': 'The project answers first',
    'timesheet-tour': 'Every hour paid',
    engine: 'The engine',
    mcp: 'MCP',
    packs: 'Packs',
    ledger: 'The ledger',
    development: 'The development pack',
    local: 'No internet, no login',
    download: 'Get Emerald',
  },

  hero: {
    name: 'Emerald',
    tagline: 'The database under the chat.',
    story: [
      'What is an application? Most are a database and a UI that exposes it. Most people now talk to an AI chat instead, the new UI, and those chats have no reliable long-term memory. Emerald closes that gap.',
    ],
  },

  tours: {
    try: 'Do my receipts line up with my credit card charges?',
    lead: 'Emerald is built to answer questions like that one. Four tours, each one question.',
    receipt: {
      label: '1 · The receipt',
      lead: 'You kept the receipt from the grocery store, and the card statement just came. Do they agree?',
      title: 'Emerald, a guided tour: did the card charge what the receipt says?',
    },
    ledger: {
      label: '2 · The ledger',
      lead: "September's pay is in and the card statement just came, I spent how much on groceries?!",
      title: 'Emerald, a guided tour: where did this month’s money go?',
    },
    development: {
      label: '3 · The development pack',
      lead: 'You\'re working on a new app with an AI model. But you forgot what you decided earlier. Recorded decisions become memory that is no longer ephemeral.',
      title: 'Emerald, a guided tour: ask for a feature, and the project answers first',
    },
    timesheet: {
      label: '4 · The timesheet',
      lead: 'You keep your hours on paper, September’s paycheck just came, and you want to know whether every hour was paid.',
      title: 'Emerald, a guided tour: was every hour I worked paid?',
    },
  },

  // DRAFT (M33 F10): a session's words for The engine, MCP and Packs, every
  // figure checked against the code on 2026-10-13 — the maintainer's to rewrite.
  engine: {
    heading: 'The engine',
    body: [
      'Declare a table for anything you keep: a charge, a paycheck, a book, a milestone. It gets real types, not a template.',
      'A value that does not fit is refused the moment it is written, not found later.',
      'Tables link, and figures are worked out across them: hours from a start and an end, a total over the rows that point here.',
      'Claims: the receipt total is the card charge, every hour was paid. Each one proved, failed or unchecked, and unchecked says why.',
      'A total never quietly skips a row it cannot read.',
      'Anything counts. Years of old accounts found in mail became one row each, and none was missed when closing them.',
    ],
    caption: "Same receipt as the first tour, same finding. There you typed it in; here a model reads it, and Emerald still says when it doesn't add up.",
    claim: {
      receipt: 'Receipt',
      receiptHead: 'Corner Market · 29 Jul',
      card: 'Card charge',
      cardHead: 'CORNER MARKET · 29 Jul',
      items: ['Bread', 'Milk', 'Eggs', 'Coffee'],
      total: 'Total',
      charged: 'Charged',
      claim: 'Claim',
      rule: 'receipt total = card charge',
      failed: 'failed · off by {off}',
      summary: 'The receipt prints 84.00. The card charged 96.00. The claim that they agree fails, off by 12.00.',
    },
  },

  // DRAFT (M33 F11): a session's words for the inbox diagram, the maintainer's to rewrite.
  inbox: {
    summary:
      'Three projects, each its own document. A session in the shop app finds that the download page moved, and writes it into the website’s inbox. The website’s next session starts with it, triages it, and applies it as a unit of work. Then the notes vault writes to the shop app.',
    caption:
      'Every project keeps its own document, and every document has an inbox. A session that finds something another project must know writes it there, and that project’s next session starts with it.',
    projects: [
      { name: 'Shop app', file: 'shop.emd' },
      { name: 'Shop website', file: 'site.emd' },
      { name: 'Notes', file: 'notes.emd' },
    ],
    inbox: 'Inbox',
    empty: 'Nothing new',
    found: 'A session here finds the download page moved to /get.',
    note: 'The download page is /get now',
    from: 'from {project}',
    starts: 'The next session starts with it: 1 new.',
    states: { new: 'new', triaged: 'triaged', applied: 'applied' },
    became: 'became unit S4 U2: point the download link at /get',
    decided: 'A session here settles a name.',
    second: 'Call it a plan, never a budget',
    recording: 'A session in a coding agent, with the development pack’s view drawn in the conversation.',
  },

  // DRAFT (M33 F12): a session's words for the ledger's four pictures, the maintainer's to rewrite.
  shots: {
    label: 'Four of the ledger’s screens',
    pause: 'Pause',
    play: 'Play',
    split: {
      label: 'The split',
      alt: 'The split: September’s net pay, less the bills, divided into buckets for two goals, a car loan, groceries and spending, each filled to what it actually got.',
      caption: 'The split: what is left after the bills gets a job, and each job shows what it actually got.',
    },
    whereitwent: {
      label: 'Where it went',
      alt: 'Where a paycheck went: the paycheck’s lines on the left, and on the right every part of it followed to the goal, the loan, the spending or the fund it landed in.',
      caption: 'Where a paycheck went: every shekel followed, from gross to where it landed.',
    },
    wealth: {
      label: 'Wealth',
      alt: 'Net worth: what is in the bank, in the funds and kept by hand, less the car loan, each counted once.',
      caption: 'Wealth: everything owned, each once, less what is owed.',
    },
    year: {
      label: 'The year',
      alt: 'A year at a glance: what came in, went out and was saved, and the taxes, with a bar for each month of 2025.',
      caption: 'The year: what came in, went out and was saved, month by month.',
    },
  },

  words: {
    mcp: {
      heading: 'A model works in it, through MCP',
      body: [
        'Your assistant reads and writes the file directly, and where the app allows, draws the sheet in the chat.',
        'Every write is shown first as a dry run. Nothing changes until you say commit.',
        'Shaped tools, never a general query: 28 for any document, 85 with the ledger.',
        'A document answers in rows, so the model asks for what it needs instead of reading notes end to end.',
        'One project’s session leaves a note in another’s inbox, and the next session there starts with it.',
        'The server opens the file it is given, does one job, closes it, and makes no network call of its own.',
        'In the Claude desktop app it is one file to install; in any other client, one line in its MCP config: npx -y emerald-mcp.',
      ],
    },
    packs: {
      heading: 'Packs',
      body: [
        'A pack is formats somebody already worked out, with their views, ready to keep in a document.',
        'Two come with Emerald: the ledger and the development pack. Making and sharing your own is next.',
      ],
    },
    ledger: {
      heading: 'The ledger',
      body: [
        'For people who want to manage their money, not be managed by it: everything they have, in one place that is theirs.',
        'Reads what you already get: card statements, bank exports, payslips, fund reports.',
        'Files every charge, and tells a transfer from a spend and a monthly bill from a one-off.',
        'Every total opens to the rows it was summed from.',
        'A year of study-fund reports read in: one month the fund received nothing, though the payslip showed the deduction.',
        'Nothing connects to your bank. You give it the files.',
      ],
    },
    development: {
      heading: 'The development pack',
      body: [
        'A project’s memory as rows: milestones, units, decisions, open questions, an inbox.',
        'A session starts from the rows, not from a summary of a chat.',
        'A request that contradicts a decision already taken is answered with the decision.',
        'Several projects, one document each, and one above them that keeps the whole lot in view.',
        'Emerald was built with Emerald this way. The third tour plays on a project like one of these.',
      ],
    },
    local: {
      heading: 'No internet, no login',
      body: [
        'Runs on your machine and sends nothing anywhere itself. It asks GitHub for a newer version only if you turn updates on.',
        'The file is yours: ordinary tools read it, back it up where you like, take it anywhere.',
      ],
    },
  },

  foot: {
    heading: 'Get Emerald',
    lead: 'Five ways in, all free: the source, the Claude extension, the Claude plugin, the npm package and the desktop app.',
    source: {
      name: 'The source, on GitHub',
      line: 'Read it, build it, run it from the repository.',
    },
    extension: {
      name: 'The Claude extension',
      line: 'For the Claude desktop app, chat and Cowork alike: download, double-click, Install. It runs on the app’s own Node.',
    },
    plugin: {
      name: 'The Claude plugin',
      line: 'For Claude Code: the server, its views in the conversation, and the hooks that start a session from your project.',
    },
    npm: {
      name: 'The npm package',
      line: 'For any other MCP client: the server, as one line in its config.',
    },
    desktop: 'The desktop app',
    windows: 'Windows',
    appleSilicon: 'macOS, Apple silicon',
    intel: 'macOS, Intel',
    unsigned:
      'The installers are not code-signed, so Windows and macOS warn on first open, and {readme} says how past each. Where a file came from is checkable without a signature: compare its SHA-256 with {sums}. Newer versions: {releases}.',
    readme: 'the README',
    sums: 'SHA256SUMS',
    releases: 'every release',
    email: 'Email',
    use: 'What would you use it for?',
    send: 'Send',
    instead: 'Write to {address}, and say what you would use it for.',
    address: 'The address is for one thing: a note when there is a new build to download. Nothing else is sent to it.',
  },

  footer: {
    line: 'Emerald is free software under the AGPL-3.0, by {author}. The {source} is on GitHub.',
    source: 'source',
  },
}
