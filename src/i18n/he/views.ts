import type { Translation } from '../catalogue.ts'

/** **The engine's views, in Hebrew** (M64 U14, D-626): the glossary's words (the `term` rows' `screen_hebrew`). */
export const views: Translation<'views'> = {
  part: '{count} {member}',
  and: '{rest} ו{last}',
  undo: 'ביטול',
  undoHint: 'להחזיר (Ctrl+Z)',
  board: {
    answer: '{parts}.',
    none: 'עוד אין כאן דבר.',
    moved: '{name} הועבר ל{member}.',
    notMoved: 'לא הועבר.',
  },
  list: {
    open: { one: 'אחת פתוחה', other: '{count} פתוחות' },
    done: { one: 'אחת הושלמה', other: '{count} הושלמו' },
    rows: { one: 'שורה אחת.', other: '{count} שורות.' },
    none: 'עוד אין דבר ברשימה הזו.',
  },
  roadmap: {
    folded: '{done} מתוך {total} שורות {title} הושלמו',
    none: 'עוד אין דבר במפת הדרכים הזו.',
  },
  ready: {
    answer: { one: 'אחת מוכנה להתחלה', other: '{count} מוכנות להתחלה' },
    held: { one: 'אחת מחכה', other: '{count} מחכות' },
    none: 'שום דבר לא מוכן להתחלה.',
  },
  agenda: {
    overdue: { one: 'אחת באיחור', other: '{count} באיחור' },
    ahead: { one: 'אחת {ahead}', other: '{count} {ahead}' },
    nothing: 'אין דבר {ahead}.',
    noFormat: 'לאף פורמט כאן אין תאריך שישים אותו בלוח הזמנים.',
  },
  dashboard: {
    answer: { one: 'בלוק אחד, מתוך {formats}.', other: '{count} בלוקים, מתוך {formats}.' },
    blocks: { one: 'בלוק אחד בלוח הזה.', other: '{count} בלוקים בלוח הזה.' },
    none: 'עוד אין דבר בלוח הזה.',
    removed: '{name} הוסר מהלוח הזה.',
  },
  connections: {
    answer: { one: '{formats}, וקשר אחד ביניהם.', other: '{formats}, ו־{count} קשרים ביניהם.' },
    none: '{formats}, ועוד אין קשר ביניהם.',
    formats: { one: 'פורמט אחד', other: '{count} פורמטים' },
    how: 'גררו פורמט אחד אל אחר כדי לקשר ביניהם.',
    panel: 'קשר',
    panelNew: 'קשר חדש',
  },
}
