import { useCallback, useState } from 'react'

import type { Provider, RuntimeKind, RuntimeProbe } from '../../../electron/bridge.ts'
import { RUNTIME_LABELS } from '../../../electron/bridge.ts'
import {
  detectRuntimes,
  isProviderSupported,
  readChosenProvider,
  writeChosenProvider,
} from '@/data/runtime/provider.ts'
import {
  diskUsed,
  diskUsedIsComplete,
  formatBytes,
  modelChoices,
  resolveProvider,
  sameProvider,
} from '@/domain/provider.ts'
import { RELEASES_URL } from '@/demo/page/page.ts'
import type { MessageKey } from '@/i18n/catalogue.ts'
import { useT } from '@/i18n/current.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'

/**
 * The local model: what is on this machine, and which of it the app will use —
 * M10's "a provider is a local runtime and a model name".
 *
 * **The screen opens off and does nothing.** Not as a stance about AI, but
 * because looking is opening a socket, and this app has spent nine milestones
 * being able to say it opens none (D-124). The one it now has is deliberate,
 * narrow and on a person's click (D-134), so the button that starts it says
 * what it will do before it does it. Nothing here runs at launch, nothing polls,
 * and closing the screen leaves nothing running.
 *
 * **Three answers per runtime, not two.** Installed and listing models;
 * installed-shaped but answering something else, which is a port collision and
 * says so; and simply not there, which is the only one where "install it" is
 * the right next sentence. Collapsing the middle into the last is how an app
 * ends up telling somebody to install what they already have.
 *
 * **The disk figure is what M10 asked to be visible before anything is
 * downloaded**, and it is honest about being a floor: a model whose runtime did
 * not state a size adds nothing rather than a guess, and the line says "at
 * least" when that happened.
 *
 * **What is deliberately not here yet.** Downloading a model, unloading one,
 * and the context a model is handed when it is chosen (D-122) — that last is a
 * measurement M10 takes rather than a guess made here, and the moment it
 * belongs to is the one this screen creates. The choice is stored where a
 * machine preference belongs and never in the document; `@/data/runtime/provider.ts`
 * carries that reasoning.
 */
export function LocalModel() {
  const t = useT()
  const supported = isProviderSupported()
  const [chosen, setChosen] = useState<Provider | undefined>(() => readChosenProvider())
  const [probes, setProbes] = useState<readonly RuntimeProbe[] | undefined>(undefined)
  const [looking, setLooking] = useState(false)
  const [failed, setFailed] = useState<string | undefined>(undefined)

  const look = useCallback(() => {
    setLooking(true)
    setFailed(undefined)
    detectRuntimes()
      .then((found) => setProbes(found))
      .catch((error: unknown) => setFailed(String(error)))
      .finally(() => setLooking(false))
  }, [])

  const choose = useCallback((provider: Provider | undefined) => {
    writeChosenProvider(provider)
    setChosen(provider)
  }, [])

  const state = resolveProvider(chosen, probes, supported)

  if (state.kind === 'unsupported') {
    return (
      // The screen's title, one sentence and one text action (M54 F4).
      <div className="px-6 py-6">
        <h1 className="m-0 text-title">{t('rail.localModel')}</h1>
        <p className="mt-2 max-w-prose text-ink-secondary">
          {t('settings.model.unsupported')}{' '}
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline hover:underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t('settings.model.getApp')}
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2">
        <span className="text-ink-secondary">
          {state.kind === 'off' ? (
            t('settings.model.noModel')
          ) : (
            <Phrase
              text={t('settings.model.using')}
              parts={{
                model: <span className="font-medium text-ink">{state.provider.model}</span>,
                runtime: RUNTIME_LABELS[state.provider.runtime],
              }}
            />
          )}
        </span>

        {state.kind === 'missing' && (
          <span className="text-caption text-negative">{state.reason}</span>
        )}

        <span className="ms-auto flex items-center gap-2">
          {state.kind !== 'off' && (
            <Button size="sm" variant="ghost" onClick={() => choose(undefined)}>
              {t('settings.model.turnOff')}
            </Button>
          )}
          <Button size="sm" variant={probes === undefined ? 'primary' : 'secondary'} onClick={look} busy={looking ? t('settings.model.looking') : undefined}>
            {probes === undefined ? t('settings.model.look') : t('settings.model.lookAgain')}
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {failed !== undefined && (
          <p className="mb-4 text-negative">{t('settings.model.shellFailed', { error: failed })}</p>
        )}

        {probes === undefined ? (
          <div className="max-w-xl space-y-3 text-ink-secondary">
            <p>
              <Phrase
                text={t('settings.model.intro')}
                parts={{ look: <span className="text-ink">{t('settings.model.look')}</span>, ports: t('settings.model.ports') }}
              />
            </p>
            <p className="text-caption text-ink-secondary">{t('settings.model.introAfter')}</p>
          </div>
        ) : (
          <div className="fc-pop-enter space-y-6">
            {probes.map((probe) => (
              <RuntimeBlock
                key={probe.runtime}
                probe={probe}
                chosen={chosen}
                onChoose={choose}
              />
            ))}
            <DiskLine probes={probes} />
          </div>
        )}
      </div>
    </div>
  )
}

/** One runtime, in whichever of its three states the last look found it. */
function RuntimeBlock({
  probe,
  chosen,
  onChoose,
}: {
  probe: RuntimeProbe
  chosen: Provider | undefined
  onChoose: (provider: Provider) => void
}) {
  const t = useT()
  return (
    <section>
      <h2 className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{RUNTIME_LABELS[probe.runtime]}</span>
        <span className="text-caption text-ink-secondary tabular-nums">{probe.origin}</span>
        {probe.kind === 'ready' && probe.version !== undefined && (
          <span className="text-caption text-ink-secondary">{t('settings.model.version', { version: probe.version })}</span>
        )}
      </h2>

      {probe.kind === 'absent' && (
        <p className="mt-1 text-ink-secondary">
          {t('settings.model.notRunning', { hint: t(INSTALL_HINT[probe.runtime]) })}
        </p>
      )}

      {probe.kind === 'unusable' && (
        // The distinction the detector exists for: something is there, so
        // "install it" would be the wrong thing to say.
        <p className="mt-1 text-ink-secondary">
          {t('settings.model.unusable', { runtime: RUNTIME_LABELS[probe.runtime], reason: probe.reason })}
        </p>
      )}

      {probe.kind === 'ready' && probe.models.length === 0 && (
        <p className="mt-1 text-ink-secondary">
          {t('settings.model.noModels', { runtime: RUNTIME_LABELS[probe.runtime] })}
        </p>
      )}

      {probe.kind === 'ready' && probe.models.length > 0 && (
        <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
          {modelChoices([probe]).map((choice) => {
            const provider: Provider = {
              runtime: choice.runtime,
              origin: choice.origin,
              model: choice.model.id,
            }
            const selected = chosen !== undefined && sameProvider(chosen, provider)
            return (
              <li key={choice.model.id}>
                <label className="flex cursor-pointer items-center gap-3 py-2">
                  <input
                    type="radio"
                    name="provider"
                    className="accent-[var(--color-accent)]"
                    checked={selected}
                    onChange={() => onChoose(provider)}
                  />
                  <span className={selected ? 'font-medium' : undefined}>{choice.model.label}</span>
                  <span className="ms-auto text-caption text-ink-secondary tabular-nums">
                    {choice.model.sizeBytes === undefined
                      ? t('settings.model.sizeNotStated')
                      : formatBytes(choice.model.sizeBytes)}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const INSTALL_HINT: Readonly<Record<RuntimeKind, MessageKey>> = {
  ollama: 'settings.model.hints.ollama',
  lmstudio: 'settings.model.hints.lmstudio',
}

/**
 * What the models found cost on disk — a floor, and it says so when it is one.
 * Nothing here downloads yet; this is the number that has to be on screen
 * before anything does.
 */
function DiskLine({ probes }: { probes: readonly RuntimeProbe[] }) {
  const t = useT()
  const found = modelChoices(probes)
  if (found.length === 0) return null
  const complete = diskUsedIsComplete(probes)
  return (
    <p className="text-caption text-ink-secondary tabular-nums">
      {t(
        found.length === 1
          ? complete
            ? 'settings.model.diskOne'
            : 'settings.model.diskOneAtLeast'
          : complete
            ? 'settings.model.diskMany'
            : 'settings.model.diskManyAtLeast',
        { n: found.length, size: formatBytes(diskUsed(probes)) },
      )}
    </p>
  )
}
