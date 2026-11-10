import { describe, expect, it } from 'vitest'
import { RELOAD_GAP_MS, isUpdateError, shouldReload } from './updates'

describe('isUpdateError', () => {
  it("spots a page's file that's gone, the way each browser says it", () => {
    expect(isUpdateError(new TypeError('Failed to fetch dynamically imported module: https://app.team4096.org/assets/ScoutingPage-Dc1mWoiC.js'))).toBe(true)
    expect(isUpdateError(new TypeError('error loading dynamically imported module: https://app.team4096.org/assets/ScoutingPage-Dc1mWoiC.js'))).toBe(true)
    expect(isUpdateError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isUpdateError(new Error('Unable to preload CSS for /assets/ScoutingPage-Dc1mWoiC.css'))).toBe(true)
  })

  it('leaves other errors alone, so a real bug still shows', () => {
    expect(isUpdateError(new TypeError("Cannot read properties of undefined (reading 'team')"))).toBe(false)
    expect(isUpdateError('Something else')).toBe(false)
  })
})

describe('shouldReload', () => {
  it('reloads the first time', () => {
    expect(shouldReload(null, 1_000_000)).toBe(true)
  })

  it("doesn't reload again straight after, so it can never loop", () => {
    expect(shouldReload(1_000_000, 1_000_000 + 5_000)).toBe(false)
    expect(shouldReload(1_000_000, 1_000_000 + RELOAD_GAP_MS)).toBe(false)
  })

  it('reloads again for a later update', () => {
    expect(shouldReload(1_000_000, 1_000_000 + RELOAD_GAP_MS + 1)).toBe(true)
  })
})
