import { describe, expect, it, vi } from 'vitest'
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
