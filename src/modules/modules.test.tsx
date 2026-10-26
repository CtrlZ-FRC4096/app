/**
 * Checks every module in src/modules/index.ts. You don't need to edit this
 * when you add a module: it picks up new ones by itself.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { modules } from '.'
import { ROLES } from '../core/session'

describe('the module list', () => {
  it('has no two modules with the same id', () => {
    const ids = modules.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(modules.map((m) => [m.id, m] as const))('%s has a usable id, a name and a purpose', (_id, m) => {
    expect(m.id).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(m.name.trim()).not.toBe('')
    expect(m.purpose.trim()).not.toBe('')
  })
})

describe.each(modules.map((m) => [m.id, m] as const))('module %s', (_id, m) => {
  it('draws its page without crashing', async () => {
    const { default: Page } = await m.load()
    expect(renderToString(<Page />).length).toBeGreaterThan(0)
  })

  it('gives a summary and attention items for every role without crashing', () => {
    for (const role of ROLES) {
      if (m.summary) expect(m.summary(role).text.trim()).not.toBe('')
      for (const notice of m.attention?.(role) ?? []) expect(notice.text.trim()).not.toBe('')
    }
  })
})
