/**
 * The four roles. Everyone starts as a student when they first sign in;
 * an admin makes people student leaders, mentors or admins in the Members
 * module.
 *
 * Each role can do everything the one before it can:
 *
 *   student < leader (student leader) < mentor < admin
 *
 * isLeader() is for things student leaders share with mentors and admins.
 * isMentor() is for things only mentors and admins do, like attendance.
 * A module decides which one each thing needs: student leaders only get
 * what a module gives them with isLeader().
 *
 * Hiding a button is not security. The database's permission rules decide
 * what each role can read and change (private.is_leader(), is_mentor() and
 * is_admin()). These checks only keep the screens tidy.
 */

export type Role = 'student' | 'leader' | 'mentor' | 'admin'
export const ROLES: Role[] = ['student', 'leader', 'mentor', 'admin']

const NAMES: Record<Role, string> = {
  student: 'Student',
  leader: 'Student leader',
  mentor: 'Mentor',
  admin: 'Admin',
}

/** Student leaders, mentors and admins: what a module shares with student leaders. */
export function isLeader(role: Role): boolean {
  return role === 'leader' || role === 'mentor' || role === 'admin'
}

/** Mentors and admins see costs, edit items and sign off skills. Not student leaders. */
export function isMentor(role: Role): boolean {
  return role === 'mentor' || role === 'admin'
}

export function isAdmin(role: Role): boolean {
  return role === 'admin'
}

export function canOpen(role: Role, allowed?: Role[]): boolean {
  return !allowed || allowed.includes(role)
}

/** The role as people say it, like "Student leader". */
export function roleName(role: Role): string {
  return NAMES[role]
}
