/**
 * **The rail's place names, in English** — the source the Hebrew in
 * `../he/rail.ts` translates (M60 U1). `src/ui/nav.ts` names each place by its
 * key here, so a place and its word cannot drift apart. A place a document or a
 * pack names — a format's title — is the document's word and is not here.
 */
export const rail = {
  home: 'Home',
  month: 'Month',
  year: 'Year',
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  paychecks: 'Paychecks',
  deductionTypes: 'Deduction types',
  plan: 'Plan',
  wealth: 'Wealth',
  netWorth: 'Net worth',
  goals: 'Goals',
  debts: 'Debts',
  funds: 'Funds',
  categories: 'Categories',
  rules: 'Rules',
  formats: 'Formats',
  connections: 'Connections',
  agenda: 'Agenda',
  assistants: 'Assistants',
  settings: 'Settings',
  packs: 'Packs',
  accounts: 'Accounts',
  localModel: 'Local model',
  calendar: 'Calendar',
  language: 'Language',
  export: 'Export',
} as const
