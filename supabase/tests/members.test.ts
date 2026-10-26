// Sign in with Slack, roles, and who can see and change the member list.
import { describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()

describe('signing in with Slack', () => {
  it('adds someone from the team workspace as a student', async () => {
    const id = await db.slackSignIn({ name: 'Riley Park', picture: 'https://example.com/riley.png' })
    const [member] = await db.sql('select * from public.members where id = $1', [id])
    expect(member).toMatchObject({ name: 'Riley Park', role: 'student', active: true, avatar_url: 'https://example.com/riley.png' })
    expect(member.slack_user_id).toMatch(/^U0TEST/)
  })

  it('turns away someone from another Slack workspace, without making an account', async () => {
    await expect(db.slackSignIn({ name: 'Outsider', team: 'T0SOMEONEELSE' })).rejects.toThrow("team's Slack workspace")
    expect(await db.sql('select * from auth.users')).toEqual([])
  })

  it('turns away any other way of signing up, such as email', async () => {
    await expect(db.slackSignIn({ name: 'Email User', provider: 'email' })).rejects.toThrow('Sign in with Slack')
    expect(await db.sql('select * from public.members')).toEqual([])
  })

  it('lets nobody in until the workspace is set', async () => {
    await db.sql("delete from private.settings where key = 'slack_team_id'")
    await expect(db.slackSignIn({ name: 'Riley Park' })).rejects.toThrow('not set up yet')
  })

  it('updates the name and picture each time Slack sends new ones', async () => {
    const id = await db.slackSignIn({ name: 'Riley Park' })
    await db.slackSignInAgain(id, { name: 'Riley P.', picture: 'https://example.com/new.png' })
    expect(await db.sql('select name, avatar_url from public.members where id = $1', [id])).toEqual([
      { name: 'Riley P.', avatar_url: 'https://example.com/new.png' },
    ])
  })

  it("ignores a name someone sets for themselves instead of Slack's", async () => {
    const id = await db.slackSignIn({ name: 'Riley Park' })
    // supabase.auth.updateUser({ data: { name } }) in the browser does this:
    await db.sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || '{"name": "Pat Mentor"}' where id = $1`, [id])
    expect(await db.sql('select name from public.members where id = $1', [id])).toEqual([{ name: 'Riley Park' }])
  })
})

describe('the member list', () => {
  it("can't be read by someone who isn't signed in", async () => {
    await db.member('Riley Park')
    await expect(db.as(null, 'select * from public.members')).rejects.toThrow(PERMISSION_DENIED)
  })

  it('can be read by every member', async () => {
    const student = await db.member('Riley Park')
    await db.member('Pat Mentor', 'mentor')
    const names = await db.as<{ name: string }>(student, 'select name from public.members order by name')
    expect(names.map((m) => m.name)).toEqual(['Pat Mentor', 'Riley Park'])
  })

  it('shows someone whose access is off only their own row', async () => {
    const leaver = await db.member('Former Student')
    await db.member('Riley Park')
    await db.switchOff(leaver)
    const rows = await db.as<{ name: string; active: boolean }>(leaver, 'select name, active from public.members')
    expect(rows).toEqual([{ name: 'Former Student', active: false }])
  })
})

describe('changing roles and access', () => {
  it("doesn't let a student make themselves a mentor", async () => {
    const student = await db.member('Riley Park')
    await db.member('Morgan Admin', 'admin')
    const changed = await db.as(student, "update public.members set role = 'mentor' where id = $1 returning id", [student])
    expect(changed).toEqual([])
    expect(await db.sql('select role from public.members where id = $1', [student])).toEqual([{ role: 'student' }])
  })

  it("doesn't let a mentor change roles", async () => {
    const mentor = await db.member('Pat Mentor', 'mentor')
    const student = await db.member('Riley Park')
    const changed = await db.as(mentor, "update public.members set role = 'mentor' where id = $1 returning id", [student])
    expect(changed).toEqual([])
  })

  it('lets an admin make someone a mentor and switch off access', async () => {
    const admin = await db.member('Morgan Admin', 'admin')
    const student = await db.member('Riley Park')
    await db.as(admin, "update public.members set role = 'mentor' where id = $1", [student])
    await db.as(admin, 'update public.members set active = false where id = $1', [student])
    expect(await db.sql('select role, active from public.members where id = $1', [student])).toEqual([{ role: 'mentor', active: false }])
  })

  it("doesn't let anyone, even an admin, change a name or Slack ID", async () => {
    const admin = await db.member('Morgan Admin', 'admin')
    const student = await db.member('Riley Park')
    await expect(db.as(admin, "update public.members set name = 'Someone Else' where id = $1", [student])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(admin, "update public.members set slack_user_id = 'U0OTHER' where id = $1", [student])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let anyone add or delete members directly", async () => {
    const admin = await db.member('Morgan Admin', 'admin')
    const student = await db.member('Riley Park')
    await expect(db.as(admin, 'delete from public.members where id = $1', [student])).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(admin, "insert into public.members (id, slack_user_id, name) values (gen_random_uuid(), 'U0NEW', 'New Person')"),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('never leaves the team without an admin', async () => {
    const admin = await db.member('Morgan Admin', 'admin')
    await expect(db.as(admin, "update public.members set role = 'mentor' where id = $1", [admin])).rejects.toThrow('at least one admin')
    await expect(db.as(admin, 'update public.members set active = false where id = $1', [admin])).rejects.toThrow('at least one admin')

    const second = await db.member('Second Admin', 'admin')
    await db.as(second, "update public.members set role = 'mentor' where id = $1", [admin])
    expect(await db.sql('select role from public.members where id = $1', [admin])).toEqual([{ role: 'mentor' }])
  })

  it('takes away an admin whose access is switched off', async () => {
    await db.member('First Admin', 'admin')
    const second = await db.member('Second Admin', 'admin')
    const student = await db.member('Riley Park')
    await db.switchOff(second)
    const changed = await db.as(second, "update public.members set role = 'mentor' where id = $1 returning id", [student])
    expect(changed).toEqual([])
  })
})

describe('the helpers every table uses', () => {
  it('report the role of whoever is asking', async () => {
    const student = await db.member('Riley Park')
    const mentor = await db.member('Pat Mentor', 'mentor')
    const admin = await db.member('Morgan Admin', 'admin')
    const ask = (id: string) =>
      db.as(id, 'select private.is_member() as member, private.is_mentor() as mentor, private.is_admin() as admin')
    expect(await ask(student)).toEqual([{ member: true, mentor: false, admin: false }])
    expect(await ask(mentor)).toEqual([{ member: true, mentor: true, admin: false }])
    expect(await ask(admin)).toEqual([{ member: true, mentor: true, admin: true }])
  })

  it('treat someone whose access is off as not a member', async () => {
    const mentor = await db.member('Pat Mentor', 'mentor')
    await db.switchOff(mentor)
    expect(await db.as(mentor, 'select private.is_member() as member, private.is_mentor() as mentor')).toEqual([
      { member: false, mentor: false },
    ])
  })

  it("can't be called by someone who isn't signed in", async () => {
    await expect(db.as(null, 'select private.is_member()')).rejects.toThrow(PERMISSION_DENIED)
  })
})
