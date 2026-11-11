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
  description:
    'Emerald, the database under the chat: a file on your machine that you and an AI model fill together, with real types and checks, so what you worked out stays true.',

  rail: {
    roadmap: 'The page, as a roadmap',
    skip: 'Skip to content',
    theme: { light: 'Light', dark: 'Dark', system: 'System', label: 'Theme: {now}. Switch to {next}.' },
    language: 'Language',
    free: 'Free software, AGPL-3.0.',
    source: 'Source',
    privacy: 'Privacy',
  },

  rows: {
    story: 'What it is',
    local: 'Runs on your machine',
    receipt: 'The receipt',
    'ledger-tour': 'Where the money went',
    'timesheet-tour': 'Every hour paid',
    ledger: 'The ledger',
    'development-tour': 'The project remembers',
    development: 'The development pack',
    engine: 'How it works',
    mcp: 'With your AI',
    packs: 'Packs',
    download: 'Get Emerald',
  },

  hero: {
    name: 'Emerald',
    tagline: 'The database under the chat.',
    story: [
      'Emerald is a desktop app that keeps your own file: a real database that you and an AI model fill together. Hand it a card statement, a payslip or a project’s notes, and it reads them into tables with real types, and tells you when something doesn’t add up.',
    ],
  },

  tours: {
    try: 'Do my receipts line up with my credit card charges?',
    lead: 'Emerald is built to answer questions like that one. Four tours, each one question.',
    receipt: {
      label: '1 · The receipt',
      lead: 'You kept the receipt from the grocery store, and the card statement just came. Do they agree?',
      title: 'Emerald, a guided tour: The receipt',
    },
    ledger: {
      label: '2 · Where the money went',
      lead: 'September’s pay is in and the card statement just came. Where did the month’s money go?',
      title: 'Emerald, a guided tour: Where the money went',
    },
    development: {
      label: '4 · The project remembers',
      lead: 'You’re building an app with an AI model, and you’ve forgotten what you decided last month. The project hasn’t: the decision is a row, and it answers first.',
      title: 'Emerald, a guided tour: The project remembers',
    },
    timesheet: {
      label: '3 · Every hour paid',
      lead: 'You keep your hours on paper, September’s paycheck just came, and you want to know whether every hour was paid.',
      title: 'Emerald, a guided tour: Every hour paid',
    },
  },

  // DRAFT (M33 F10): a session's words for The engine, MCP and Packs, every
  // figure checked against the code on 2026-10-13 — the maintainer's to rewrite.
  engine: {
    heading: 'How it works',
    body: [
      'Declare a format for anything you keep (a charge, a paycheck, a book, a milestone): its fields, stored as a real table with real types, not a template.',
      'A value that does not fit is refused the moment it is written, not found later.',
      'Tables link, and figures are worked out across them: hours from a start and an end, a total over the rows that point here.',
      'Say what should add up (the receipt total is the card charge, every hour was paid) and each row shows whether it does: proved, failed, or unchecked with the reason.',
      'A total never quietly skips a row it cannot read.',
      'Anything you keep can be a table. Old accounts found in years of mail became one row each, and none was missed when closing them.',
    ],
    caption: 'Same receipt as the first tour: the lines arrive, the total and the charge follow, and the claim that they agree fails by 12.00.',
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
    became: 'became a task: point the download link at /get',
    decided: 'A session here settles a name.',
    second: 'Call it a plan, never a budget',
    recording: 'A session in a coding agent, with the development pack’s view drawn in the conversation.',
  },

  // DRAFT (M56 U6): a session's words for the recordings inside Claude, the maintainer's to rewrite
  // (docs/page-recording-claude.md has the shots they sit under).
  claude: {
    label: 'Inside Claude',
    lead: 'The project beside the conversation, kept current while you work.',
    pane: 'A session starts, and the project is already beside it: what is ready, what is open.',
    terminal: 'The same pane in a terminal session.',
    inbox: 'A note left by a session in another project arrives while you work, and waits in the project.',
    format: 'Something new to keep, said in a sentence: declared as a format, and its pane filling as the rows are written.',
  },

  // DRAFT (M33 F12): a session's words for the ledger's four pictures, the maintainer's to rewrite.
  shots: {
    label: 'Four of the ledger’s screens',
    pause: 'Pause',
    split: {
      label: 'The split',
      alt: 'The split: September’s net pay, less the bills, divided into buckets for two goals, a car loan, groceries and spending, each filled to what it actually got.',
      caption: 'The split: what is left after the bills gets a job, and each job shows what it actually got.',
    },
    whereitwent: {
      label: 'Where it went',
      alt: 'Where a paycheck went: the paycheck’s lines on the left, and on the right every part of it followed to the goal, the loan, the spending or the fund it landed in.',
      caption: 'Where a paycheck went: all of it followed, from gross to where it landed.',
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
      heading: 'Your AI assistant works in it',
      body: [
        'Your assistant reads and writes the file directly, through MCP, the standard way assistants connect to tools, and where the app allows, draws the sheet in the chat.',
        'Every write is shown first as a dry run. Nothing changes until you say commit.',
        'The model gets named actions, never free rein over the database: 28 for any document, 86 with the ledger.',
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
        'A year of savings-fund reports read in: one month the fund received nothing, though the payslip showed the deduction.',
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
        'Emerald was built with Emerald this way. The fourth tour plays on a project like one of these.',
      ],
    },
    local: {
      heading: 'Runs on your machine',
      body: [
        'Runs on your machine and sends nothing anywhere itself. It asks GitHub for a newer version only if you turn updates on.',
        'The file is yours: ordinary tools read it, back it up where you like, take it anywhere.',
      ],
    },
  },

  foot: {
    heading: 'Get Emerald',
    lead: 'All free. The desktop app for your own files; the Claude extension, the Claude plugin or the npm package to work in it with a model; or the source.',
    source: {
      name: 'The source, on GitHub',
      line: 'Read it, build it, run it from the repository.',
    },
    extension: {
      name: 'The Claude extension',
      line: 'For the Claude desktop app, chat and Cowork alike: download, double-click, Install. Nothing else to install.',
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
