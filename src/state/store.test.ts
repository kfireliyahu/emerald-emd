import { describe, expect, it } from 'vitest'

import { createStore } from './store.ts'

describe('createStore (M45 U3)', () => {
  it('holds a value and tells subscribers when it changes', () => {
    const store = createStore(1)
    let told = 0
    const stop = store.subscribe(() => (told += 1))
    store.set(2)
    expect(store.get()).toBe(2)
    expect(told).toBe(1)
    stop()
    store.set(3)
    expect(told).toBe(1)
  })

  it('does not tell anybody about the same value', () => {
    const store = createStore('a')
    let told = 0
    store.subscribe(() => (told += 1))
    store.set('a')
    expect(told).toBe(0)
  })

  it('takes its own idea of the same value, for a fresh object per write', () => {
    const store = createStore<{ readonly at: number }>({ at: 1 }, (a, b) => a.at === b.at)
    const first = store.get()
    let told = 0
    store.subscribe(() => (told += 1))
    store.set({ at: 1 })
    expect(store.get()).toBe(first)
    expect(told).toBe(0)
    store.set({ at: 2 })
    expect(told).toBe(1)
  })
})
