/**
 * Checks every module in src/modules/index.ts. You don't need to edit this
 * when you add a module: it picks up new ones by itself.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { modules } from '.'
import { ROLES, canOpen, type Role } from '../core/session'
import { groupModules } from '../core/registry'
import { setDemoRole } from '../core/demo'
import type { Notice } from '../core/registry'

afterAll(() => setDemoRole('student'))

// expect.soft keeps going after a failure, so one run reports every module
// that breaks a rule, not just the first.
describe('the module list', () => {
  it('has no two modules with the same id', () => {
    const ids = modules.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every module a usable id, a name and a purpose', () => {
    for (const m of modules) {
      expect.soft(m.id, 'an id like "pit-checklist"').toMatch(/^[a-z][a-z0-9-]*$/)
      expect.soft(m.name.trim(), `${m.id}'s name`).not.toBe('')
      expect.soft(m.purpose.trim(), `${m.id}'s purpose`).not.toBe('')
    }
  })

  it('shows every module in one of the menus in the top bar', () => {
    const inMenus = groupModules(modules).flatMap((group) => group.modules.map((m) => m.id))
    expect(inMenus.toSorted()).toEqual(modules.map((m) => m.id).toSorted())
  })

  it('gives every page a name and a usable address, different from its other pages', () => {
    for (const m of modules.filter((m) => m.pages)) {
      const pages = m.pages ?? []
      expect.soft(pages.length, `${m.id}'s pages`).toBeGreaterThan(0)
      const paths = pages.map((p) => p.path)
      expect.soft(new Set(paths).size, `${m.id}'s page addresses`).toBe(paths.length)
      for (const page of pages) {
        expect.soft(page.name.trim(), `the name of ${m.id}/${page.path}`).not.toBe('')
        expect.soft(page.path, `the address of ${m.id}'s ${page.name} page`).toMatch(/^([a-z][a-z0-9-]*)?$/)
      }
    }
  })

  it('gives every kind of notification a key starting with its module id, used once, with a name and a description', () => {
    const keys = modules.flatMap((m) => (m.notifications ?? []).map((kind) => kind.key))
    expect(new Set(keys).size, 'two kinds of notification share a key').toBe(keys.length)
    for (const m of modules) {
      for (const kind of m.notifications ?? []) {
        // The database checks the same shape (..._notification_settings.sql).
        expect.soft(kind.key, `a key like "${m.id}.request_updates"`).toMatch(new RegExp(`^${m.id}\\.[a-z][a-z0-9_]*$`))
        expect.soft(kind.name.trim(), `${kind.key}'s name`).not.toBe('')
        expect.soft(kind.description.trim(), `${kind.key}'s description`).not.toBe('')
      }
    }
  })
})

/** Do `check` signed in as each role, and say which role it was if it fails. */
function asEach(roles: Role[], check: (role: Role) => void) {
  for (const role of roles) {
    setDemoRole(role)
    try {
      check(role)
    } catch (error) {
      if (error instanceof Error) error.message = `As a ${role}: ${error.message}`
      throw error
    }
  }
}

describe.each(modules.map((m) => [m.id, m] as const))('module %s', (_id, m) => {
  it('draws its page for everyone who can open it, without crashing', async () => {
    const { default: Page } = await m.load()
    asEach(ROLES.filter((role) => canOpen(role, m.roles)), () => {
      expect(renderToString(<Page />).length).toBeGreaterThan(0)
    })
  })

  it('gives the home page a status and attention items for everyone, without crashing', () => {
    asEach(ROLES, (role) => {
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
})
