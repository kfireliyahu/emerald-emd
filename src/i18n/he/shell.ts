import type { Translation } from '../catalogue.ts'

/**
 * **The desktop shell's own words, in Hebrew** (M60 U7, D-588). Where an item is
 * a term, the word is the glossary's (`screen_hebrew`, M60 U2): *Save as*,
 * *Guide me*. The rest are drafts written to fit it, listed on an open
 * review_entry. Read by the shell itself, so it imports nothing but a type.
 *
 * `&` marks each menu's first letter, as in English: on a Hebrew keyboard Alt
 * and that letter open it, and on any keyboard Alt and the arrows do.
 */
export const shell: Translation<'shell'> = {
  menu: {
    file: '&קובץ',
    edit: '&עריכה',
    view: '&תצוגה',
    help: '&עזרה',
    new: 'חדש',
    open: 'פתיחה…',
    openRecent: 'מסמכים אחרונים',
    nothingYet: 'עדיין אין',
    clearRecents: 'ניקוי רשימת המסמכים האחרונים',
    save: 'שמירה',
    saveAs: 'שמירה בשם…',
    earlierCopies: 'עותקים קודמים של המסמך…',
    closeWindow: 'סגירת החלון',
    quit: 'יציאה',
    undo: 'ביטול פעולה',
    redo: 'ביצוע חוזר',
    cut: 'גזירה',
    copy: 'העתקה',
    paste: 'הדבקה',
    selectAll: 'בחירת הכול',
    commands: 'פקודות…',
    toggleSidebar: 'הצגה או הסתרה של סרגל הצד',
    actualSize: 'גודל אמיתי',
    zoomIn: 'הגדלה',
    zoomOut: 'הקטנה',
    fullScreen: 'מסך מלא',
    developerTools: 'כלי מפתחים',
    guide: 'הדרכה',
    license: 'רישיון',
    notices: 'הודעות צד שלישי',
    source: 'קוד המקור',
    sourceHint: 'נפתח בדפדפן',
    checkForUpdates: 'בדיקת עדכונים עכשיו',
    about: 'אודות Emerald',
  },
  dialogs: {
    saveAsTitle: 'שמירה בשם',
    documentFilter: 'מסמך Emerald',
    thisDocument: 'המסמך הזה',
    save: 'שמירה',
    dontSave: 'בלי לשמור',
    cancel: 'ביטול',
    unsavedClosing: 'לשמור את {name} לפני הסגירה?',
    unsavedRestarting: 'לשמור את {name} לפני ההפעלה מחדש?',
    unsavedDetail: 'אחרת, כל מה שנעשה מאז השמירה האחרונה יאבד.',
    unsavedRestartingDetail: 'Emerald ייפתח מחדש כדי להתקין את העדכון. אחרת, כל מה שנעשה מאז השמירה האחרונה יאבד.',
    crashedAgain: 'החלון הזה הפסיק לעבוד שוב.',
    crashedAgainDetail: 'אפשר לסגור אותו ולפתוח את Emerald שוב: עבודה שלא נשמרה תוצע בחזרה בפתיחה.',
  },
  windows: {
    license: 'Emerald — רישיון (GNU AGPL-3.0)',
    notices: 'Emerald — הודעות צד שלישי',
  },
}
