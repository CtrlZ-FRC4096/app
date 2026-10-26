import { describe, expect, it } from 'vitest'
import { href, parseRoute } from './router'

describe('parseRoute', () => {
  it('reads the module id and the rest of the address', () => {
    expect(parseRoute('#/inventory/INV-011')).toEqual({ id: 'inventory', rest: ['INV-011'] })
  })

  it('treats an empty address as the home page', () => {
    expect(parseRoute('')).toEqual({ id: '', rest: [] })
    expect(parseRoute('#/')).toEqual({ id: '', rest: [] })
  })
})

describe('href', () => {
  it('builds addresses that parseRoute reads back', () => {
    expect(parseRoute(href('scouting', 'qm 14'))).toEqual({ id: 'scouting', rest: ['qm 14'] })
  })
})
