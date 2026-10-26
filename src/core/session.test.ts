import { describe, expect, it } from 'vitest'
import { findAccess } from './session'
import { explainSignInError } from './supabase'
import { DEMO_PEOPLE } from './demo'
import type { Member } from './members'

const member = (changes: Partial<Member> = {}): Member => ({
  id: 'u1',
  slack_user_id: 'U1',
  name: 'Riley Park',
  avatar_url: null,
  role: 'student',
  active: true,
  created_at: '2026-10-01T00:00:00Z',
  ...changes,
})

describe('findAccess in live mode', () => {
  const live = true

  it('lets in an active member, with their role from the member list', () => {
    expect(findAccess({ status: 'signed-in', userId: 'u1' }, 'student', [member({ role: 'mentor' })], live)).toEqual({
      status: 'ok',
      user: { id: 'u1', name: 'Riley Park', role: 'mentor', avatarUrl: null },
    })
  })

  it('ignores the demo "View as" switch', () => {
    const access = findAccess({ status: 'signed-in', userId: 'u1' }, 'admin', [member()], live)
    expect(access.status === 'ok' && access.user.role).toBe('student')
  })

  it("keeps out someone whose access is switched off, and says why", () => {
    const access = findAccess({ status: 'signed-in', userId: 'u1' }, 'student', [member({ active: false })], live)
    expect(access).toMatchObject({ status: 'no-access', name: 'Riley Park' })
    expect(access.status === 'no-access' && access.reason).toMatch(/switched off/)
  })

  it("keeps out someone who isn't on the member list", () => {
    expect(findAccess({ status: 'signed-in', userId: 'u2' }, 'student', [member()], live).status).toBe('no-access')
  })

  it('keeps out someone who is signed out', () => {
    expect(findAccess({ status: 'signed-out', error: null }, 'student', [member()], live).status).toBe('no-access')
  })
})

describe('findAccess in demo mode', () => {
  it('uses the "View as" switch to pick a made-up person', () => {
    const access = findAccess({ status: 'signed-in', userId: '' }, 'mentor', [member({ id: DEMO_PEOPLE.pat, name: 'Pat Chen' })], false)
    expect(access).toEqual({ status: 'ok', user: { id: DEMO_PEOPLE.pat, name: 'Pat Chen', role: 'mentor', avatarUrl: null } })
  })
})

describe('explainSignInError', () => {
  it('explains the database turning someone away as a workspace problem', () => {
    expect(explainSignInError('server_error', 'Database error saving new user')).toMatch(/Ctrl-Z Slack workspace/)
  })

  it('explains a cancelled sign-in', () => {
    expect(explainSignInError('access_denied', 'The user denied the request')).toMatch(/cancelled/)
  })
})
