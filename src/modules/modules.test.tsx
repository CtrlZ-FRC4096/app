/**
 * Checks every module in src/modules/index.ts. You don't need to edit this
 * when you add a module: it picks up new ones by itself.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { modules } from '.'
import { ROLES, canOpen } from '../core/session'
import { groupModules } from '../core/registry'
import { setDemoRole } from '../core/demo'
import type { Notice } from '../core/registry'

afterAll(() => setDemoRole('student'))

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

  it('shows every module in one of the menus in the top bar', () => {
    const inMenus = groupModules(modules).flatMap((group) => group.modules.map((m) => m.id))
    expect(inMenus.toSorted()).toEqual(modules.map((m) => m.id).toSorted())
  })
})

describe.each(modules.map((m) => [m.id, m] as const))('module %s', (_id, m) => {
  it.each(ROLES.filter((role) => canOpen(role, m.roles)))('draws its page for a %s without crashing', async (role) => {
    setDemoRole(role)
    const { default: Page } = await m.load()
    expect(renderToString(<Page />).length).toBeGreaterThan(0)
  })

  it.each(ROLES)('gives the home page a status and attention items for a %s without crashing', (role) => {
    setDemoRole(role)
    let summary: Notice | undefined
    let attention: Notice[] = []
    function Summary() {
      summary = m.useSummary!(role)
      return null
    }
    function Attention() {
      attention = m.useAttention!(role)
      return null
    }
    if (m.useSummary) {
      renderToString(<Summary />)
      expect(summary?.text.trim()).not.toBe('')
    }
    if (m.useAttention) {
      renderToString(<Attention />)
      for (const notice of attention) expect(notice.text.trim()).not.toBe('')
    }
  })
})
