import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore, resetAllStores } from './store'

describe('createStore', () => {
  it('starts from the example data and accepts changes', () => {
    const store = createStore('test-a', 1, () => ({ count: 1 }))
    store.set((prev) => ({ count: prev.count + 1 }))
    expect(store.get()).toEqual({ count: 2 })
  })

  it('tells subscribers about changes, and stops after they unsubscribe', () => {
    const store = createStore('test-b', 1, () => 0)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.set(5)
    unsubscribe()
    store.set(6)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('goes back to the example data on reset', () => {
    const store = createStore('test-c', 1, () => ['a'])
    store.set(['a', 'b'])
    resetAllStores()
    expect(store.get()).toEqual(['a'])
  })

  it('leaves stores marked keepOnReset alone', () => {
    const kept = createStore('test-d', 1, () => 'student', { keepOnReset: true })
    kept.set('mentor')
    resetAllStores()
    expect(kept.get()).toBe('mentor')
  })
})

describe('two tabs', () => {
  // Node has no browser storage or tabs, so stand in for them: a saved copy,
  // and the "storage" event a browser sends when another tab saves.
  function fakeBrowser() {
    const saved = new Map<string, string>()
    const listeners: ((event: { key: string | null; newValue: string | null }) => void)[] = []
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    })
    vi.stubGlobal('addEventListener', (type: string, listener: (typeof listeners)[number]) => {
      if (type === 'storage') listeners.push(listener)
    })
    /** Another tab saved `value` under `key`. */
    const otherTabSaves = (key: string, value: unknown) => {
      const raw = value === undefined ? null : JSON.stringify(value)
      if (raw == null) saved.delete(key)
      else saved.set(key, raw)
      listeners.forEach((listener) => listener({ key, newValue: raw }))
    }
    /** Another tab saved something under `key` that isn't readable. */
    const otherTabSavesRaw = (key: string, raw: string) => {
      saved.set(key, raw)
      listeners.forEach((listener) => listener({ key, newValue: raw }))
    }
    return { saved, otherTabSaves, otherTabSavesRaw }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("adds to what another tab saved, instead of writing over it", () => {
    const browser = fakeBrowser()
    const store = createStore<string[]>('test-tabs', 1, () => [], { keepOnReset: true })
    store.set((list) => ['match 12', ...list])
    browser.otherTabSaves('ctrlz-app:test-tabs:v1', ['match 13', 'match 12'])
    store.set((list) => ['match 14', ...list])
    expect(store.get()).toEqual(['match 14', 'match 13', 'match 12'])
    expect(JSON.parse(browser.saved.get('ctrlz-app:test-tabs:v1')!)).toEqual(['match 14', 'match 13', 'match 12'])
  })

  it("tells subscribers when another tab saves, so the page shows it", () => {
    const browser = fakeBrowser()
    const store = createStore('test-tabs-b', 1, () => 0)
    const listener = vi.fn()
    store.subscribe(listener)
    browser.otherTabSaves('ctrlz-app:test-tabs-b:v1', 5)
    expect(store.get()).toBe(5)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('goes back to the example data when another tab resets it', () => {
    const browser = fakeBrowser()
    const store = createStore('test-tabs-c', 1, () => 'start')
    store.set('changed')
    browser.otherTabSaves('ctrlz-app:test-tabs-c:v1', undefined)
    expect(store.get()).toBe('start')
  })

  it("ignores other stores, and a saved copy it can't read", () => {
    const browser = fakeBrowser()
    const store = createStore('test-tabs-d', 1, () => 'start')
    browser.otherTabSaves('ctrlz-app:something-else:v1', 'other')
    browser.otherTabSavesRaw('ctrlz-app:test-tabs-d:v1', '{not json')
    expect(store.get()).toBe('start')
  })
})
