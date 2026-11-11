import { setLanguage, useLanguage, useT } from '@/i18n/current.ts'
import { isLanguage, LANGUAGE_NAMES, LANGUAGES } from '@/i18n/language.ts'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'

/**
 * **Settings › Language** — M60 U1 (D-583, D-584). The language of the app's
 * own words, on this machine.
 *
 * This computer's and not the document's — the opposite of Calendar beside it,
 * and for the reason D-583 gives: two people open one document in two
 * languages. Until a language is chosen here the app follows the computer's;
 * each is offered by its own name, so a person finds theirs whichever the app
 * is in. What a document holds is not translated, and the line under the row
 * says so.
 */
export function Language() {
  const t = useT()
  const language = useLanguage()

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex max-w-4xl flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-col gap-1.5 border-b border-hairline pb-4">
          <span className="fc-label text-ink-secondary uppercase">
            {t('rail.settings')} · {t('rail.language')}
          </span>
          <h1 className="m-0 text-title">{t('rail.language')}</h1>
          <span className="text-ink-secondary">{t('settings.language.lead')}</span>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline py-4">
          <div>
            <label htmlFor="app-language" className="font-medium">
              {t('settings.language.row')}
            </label>
            <p className="m-0 mt-0.5 max-w-[60ch] text-ink-secondary">{t('settings.language.hint')}</p>
          </div>
          <ChoiceField
            id="app-language"
            className={`${FIELD} h-7 w-32`}
            readOnly
            filter={false}
            text={LANGUAGE_NAMES[language]}
            choices={LANGUAGES.map((each) => ({ value: each, label: LANGUAGE_NAMES[each] }))}
            onText={() => undefined}
            onPick={(choice) => {
              if (isLanguage(choice.value)) setLanguage(choice.value)
            }}
          />
        </div>
      </div>
    </div>
  )
}
