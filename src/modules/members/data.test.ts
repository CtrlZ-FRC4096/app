// Tests for data.ts. The database rules behind these are tested in
// supabase/tests/members.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { membersTable } from '../../core/members'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { changeRole, search, setAccess } from './data'

const person = (id: string) => membersTable.rows().find((m) => m.id === id)!

beforeEach(() => {
  membersTable.reset()
  setDemoRole('admin')
})

describe('changeRole', () => {
  it('lets an admin make a student a mentor', async () => {
    const result = await changeRole(person(DEMO_PEOPLE.jordan), 'mentor')
    expect(result.ok).toBe(true)
    expect(person(DEMO_PEOPLE.jordan).role).toBe('mentor')
  })

  it("doesn't let a mentor change roles", async () => {
    setDemoRole('mentor')
    expect(await changeRole(person(DEMO_PEOPLE.jordan), 'mentor')).toEqual({ ok: false, error: 'Only admins can change roles and access.' })
    expect(person(DEMO_PEOPLE.jordan).role).toBe('student')
  })

  it("doesn't let an admin change their own role", async () => {
    const result = await changeRole(person(DEMO_PEOPLE.morgan), 'student')
    expect(result.ok).toBe(false)
    expect(person(DEMO_PEOPLE.morgan).role).toBe('admin')
  })
})

describe('setAccess', () => {
  it('switches access off and back on', async () => {
    await setAccess(person(DEMO_PEOPLE.jordan), false)
    expect(person(DEMO_PEOPLE.jordan).active).toBe(false)
    await setAccess(person(DEMO_PEOPLE.jordan), true)
    expect(person(DEMO_PEOPLE.jordan).active).toBe(true)
  })
})

describe('search', () => {
  it('finds people by any part of their name, ignoring capitals', () => {
    expect(search(membersTable.rows(), 'CHEN').map((m) => m.name)).toEqual(['Pat Chen'])
    expect(search(membersTable.rows(), '  ')).toHaveLength(membersTable.rows().length)
  })
})

describe('checkServerFunctions', () => {
  type Answers = Record<string, { ok: true; value: unknown } | { ok: false; error: string }>
  async function withAnswers(answers: Answers) {
    vi.resetModules()
    vi.doMock('../../core/functions', () => ({ callFunction: vi.fn(async (name: string) => answers[name]) }))
    const { checkServerFunctions } = await import('./data')
    return checkServerFunctions()
  }
  afterEach(() => {
    vi.doUnmock('../../core/functions')
    vi.resetModules()
  })

  it('says when the functions aren\'t deployed', async () => {
    expect(await withAnswers({ hello: { ok: false, error: "The hello server function isn't set up yet." } })).toEqual([
      { name: 'Server functions', ok: false, text: "The hello server function isn't set up yet." },
    ])
  })

  it('says which keys are missing, without calling those functions', async () => {
    const checks = await withAnswers({ hello: { ok: true, value: { message: 'Hi Pat', role: 'admin', secrets: { TBA_KEY: false, ONSHAPE_ACCESS_KEY: true } } } })
    expect(checks.map((c) => [c.name, c.ok])).toEqual([['Server functions', true], ['The Blue Alliance', false], ['Onshape', false]])
    expect(checks[1].text).toMatch(/TBA_KEY/)
    expect(checks[2].text).toBe('No ONSHAPE_SECRET_KEY secret yet. Add it in Supabase: see "Server functions" in supabase/README.md.')
  })

  it('asks Onshape whether the keys work when both are set', async () => {
    const hello = { ok: true as const, value: { message: 'Hi Pat', role: 'admin', secrets: { TBA_KEY: true, ONSHAPE_ACCESS_KEY: true, ONSHAPE_SECRET_KEY: true } } }
    const working = await withAnswers({ hello, tba: { ok: true, value: { nickname: 'Ctrl-Z' } }, onshape: { ok: true, value: { ok: true } } })
    expect(working[2]).toEqual({ name: 'Onshape', ok: true, text: 'Working: Onshape accepted the keys. Import a system from the BOM page.' })
    const turnedDown = await withAnswers({ hello, tba: { ok: true, value: { nickname: 'Ctrl-Z' } }, onshape: { ok: false, error: 'Onshape turned down the keys.' } })
    expect(turnedDown[2]).toEqual({ name: 'Onshape', ok: false, text: 'Onshape turned down the keys.' })
  })

  it('asks The Blue Alliance for team 4096 when the key is set', async () => {
    const checks = await withAnswers({
      hello: { ok: true, value: { message: 'Hi Pat', role: 'admin', secrets: { TBA_KEY: true } } },
      tba: { ok: true, value: { nickname: 'Ctrl-Z' } },
    })
    expect(checks[1]).toEqual({ name: 'The Blue Alliance', ok: true, text: 'Working: it says team 4096 is Ctrl-Z.' })
  })
})
