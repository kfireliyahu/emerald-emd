import { setLanguage, useLanguage, useT } from '@/i18n/current.ts'
import { isLanguage, LANGUAGE_NAMES, LANGUAGES } from '@/i18n/language.ts'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { SettingRow, SettingsPage } from '@/ui/settings/SettingsPage.tsx'

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
 *
 * **The report** (M64 U12, D-624): the answer first — which language the app's
 * words are in here — and the one choice under it.
 */
export function Language() {
  const t = useT()
  const language = useLanguage()

  return (
    <SettingsPage title={t('rail.language')} answer={t('settings.language.answer', { language: LANGUAGE_NAMES[language] })}>
      <SettingRow label={t('settings.language.row')} htmlFor="app-language" hint={t('settings.language.hint')}>
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
      </SettingRow>
    </SettingsPage>
  )
}
