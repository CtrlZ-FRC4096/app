import { describe, expect, it } from 'vitest'
import { ROLES, isAdmin, isLeader, isMentor, roleName } from './roles'

describe('roles', () => {
  it('lists every role, from student up to admin', () => {
    expect(ROLES).toEqual(['student', 'leader', 'mentor', 'admin'])
  })

  it('counts student leaders, mentors and admins as leaders', () => {
    expect(ROLES.filter(isLeader)).toEqual(['leader', 'mentor', 'admin'])
  })

  it("doesn't count student leaders as mentors, so mentor-only things stay that way", () => {
    expect(ROLES.filter(isMentor)).toEqual(['mentor', 'admin'])
    expect(ROLES.filter(isAdmin)).toEqual(['admin'])
  })

  it('names each role the way the team says it', () => {
    expect(ROLES.map(roleName)).toEqual(['Student', 'Student leader', 'Mentor', 'Admin'])
  })
})
