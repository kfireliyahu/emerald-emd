/**
 * What the app makes of a chosen provider and what detection found — the
 * decisions between "a runtime is installed" and "a model will answer".
 *
 * Plain TypeScript: no React, no sql.js, no DOM (docs/conventions.md). The
 * probing itself is `electron/runtimes.ts`, in the main process, because the
 * page may not open a socket (D-134); the shapes are on the bridge, which is
 * the one file `src/` imports from `electron/`.
 *
 * **The question this file exists to answer is the third one.** A screen has to
 * distinguish three states that a naive `chosen !== undefined` collapses into
 * one: nothing is chosen, something is chosen and will answer, and something is
 * chosen and *will not* — because the runtime was stopped, or the model was
 * deleted from underneath it. The third is not an edge case. Models are large,
 * and the thing a person does with a large file they stopped using is delete
 * it. Finding out at generation time is finding out too late, in the middle of
 * something else.
 *
 * This is the same shape as the document conflict D-092 raised: a stored
 * reference to something outside the document, checked rather than assumed.
 */

import type { ModelCard, Provider, RuntimeKind, RuntimeProbe } from '../../electron/bridge.ts'

/**
 * Where a provider stands, from the app's point of view.
 *
 * `off` is the default and the resting state, and it is not a failure — the app
 * is whole with the feature off, which is the F11 rule that outlived the note
 * D-124 archived.
 */
export type ProviderState =
  /** No shell: a browser tab has no bridge, so it has no provider. */
  | { readonly kind: 'unsupported' }
  /** Nothing chosen. Off by default means this is where everyone starts. */
  | { readonly kind: 'off' }
  /** Chosen, and the last look found it. */
  | { readonly kind: 'ready'; readonly provider: Provider; readonly model: ModelCard }
  /** Chosen, and the last look did not find it. Says which of the ways. */
  | { readonly kind: 'missing'; readonly provider: Provider; readonly reason: string }

/** One model a person could pick, carrying the runtime that has it. */
export interface ModelChoice {
  readonly runtime: RuntimeKind
  readonly origin: string
  readonly model: ModelCard
}

/**
 * Is this the provider the person chose? Compared on all three fields.
 *
 * The origin is part of the identity on purpose: the same model name served by
 * a runtime that has moved ports is a different thing to connect to, and
 * silently following it would be the app deciding where to send a request.
 */
export function sameProvider(a: Provider, b: Provider): boolean {
  return a.runtime === b.runtime && a.origin === b.origin && a.model === b.model
}

/**
 * Everything that could be picked, flattened across runtimes, in the order the
 * probes came back.
 *
 * A runtime that is `ready` with an empty list contributes nothing here and is
 * still worth drawing — "installed, and it has no models" is a sentence with a
 * different next step than "not installed", which is why `detectRuntimes`
 * answers for every runtime rather than returning only the ones that worked.
 */
export function modelChoices(probes: readonly RuntimeProbe[]): readonly ModelChoice[] {
  const choices: ModelChoice[] = []
  for (const probe of probes) {
    if (probe.kind !== 'ready') continue
    for (const model of probe.models) {
      choices.push({ runtime: probe.runtime, origin: probe.origin, model })
    }
  }
  return choices
}

/**
 * What the models found take up on disk, in bytes.
 *
 * The number M10 asks to be visible before anything is downloaded. A model
 * whose runtime did not state a size contributes nothing rather than a guess,
 * so this is a floor and the screen must not present it as a total.
 */
export function diskUsed(probes: readonly RuntimeProbe[]): number {
  let total = 0
  for (const choice of modelChoices(probes)) total += choice.model.sizeBytes ?? 0
  return total
}

/** Whether every model found stated its size — what lets a caller say "at least". */
export function diskUsedIsComplete(probes: readonly RuntimeProbe[]): boolean {
  return modelChoices(probes).every((choice) => choice.model.sizeBytes !== undefined)
}

/**
 * The stored choice, the last look, and what the two of them mean together.
 *
 * `probes` being `undefined` means nobody has looked yet — which is the
 * ordinary state at launch, because nothing probes until a person asks (D-134).
 * A choice that has not been checked is reported `ready` on the strength of
 * having been chosen: the alternative is telling somebody their model is
 * missing because the app has not looked, which is worse than silence.
 */
export function resolveProvider(
  chosen: Provider | undefined,
  probes: readonly RuntimeProbe[] | undefined,
  supported: boolean,
): ProviderState {
  if (!supported) return { kind: 'unsupported' }
  if (chosen === undefined) return { kind: 'off' }

  if (probes === undefined) {
    return { kind: 'ready', provider: chosen, model: { id: chosen.model, label: chosen.model } }
  }

  const probe = probes.find((entry) => entry.runtime === chosen.runtime)
  if (probe === undefined || probe.kind === 'absent') {
    return { kind: 'missing', provider: chosen, reason: 'that runtime is not running' }
  }
  if (probe.kind === 'unusable') {
    return { kind: 'missing', provider: chosen, reason: probe.reason }
  }
  if (probe.origin !== chosen.origin) {
    return { kind: 'missing', provider: chosen, reason: 'that runtime has moved' }
  }

  const model = probe.models.find((entry) => entry.id === chosen.model)
  if (model === undefined) {
    return { kind: 'missing', provider: chosen, reason: 'that model is no longer installed' }
  }
  return { kind: 'ready', provider: chosen, model }
}

/**
 * A size a person can read. Binary units, because that is what both runtimes
 * and every disk dialog on both platforms print.
 *
 * One decimal below 100 and none above it, so `4.9 GB` and `17.3 GB` line up
 * against each other and a 250 GB disk does not print a tenth nobody can act
 * on. Whole bytes never take one at all.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : value < 100 ? 1 : 0
  return `${value.toFixed(digits)} ${units[unit] ?? 'bytes'}`
}
