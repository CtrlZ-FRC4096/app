// Tests for data.ts. The database rules behind these are tested in
// supabase/tests/members.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
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
