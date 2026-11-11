import type { Translation } from '../catalogue.ts'

/** **Settings' words, in Hebrew** (M60 U1). Drafts until the glossary (M60 U2). */
export const settings: Translation<'settings'> = {
  language: {
    lead: 'השפה של המילים של האפליקציה במחשב הזה. היא נשמרת במחשב ולעולם לא במסמך, כך ששני אנשים יכולים לפתוח מסמך אחד בשתי שפות.',
    row: 'שפה',
    hint: 'מה שמסמך מחזיק נשאר כפי שנכתב. עד שנבחרת כאן שפה, האפליקציה עוקבת אחרי שפת המחשב.',
  },
}
