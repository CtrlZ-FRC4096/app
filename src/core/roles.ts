/**
 * The three roles. Everyone starts as a student when they first sign in;
 * an admin makes people mentors or admins in the Members module.
 *
 * Hiding a button is not security. The database's permission rules decide
 * what each role can read and change. These checks only keep the screens
 * tidy.
 */

export type Role = 'student' | 'mentor' | 'admin'
export const ROLES: Role[] = ['student', 'mentor', 'admin']

/** Mentors and admins see costs, edit items and sign off skills. */
export function isMentor(role: Role): boolean {
  return role === 'mentor' || role === 'admin'
}

export function isAdmin(role: Role): boolean {
  return role === 'admin'
}

export function canOpen(role: Role, allowed?: Role[]): boolean {
  return !allowed || allowed.includes(role)
}

export function roleName(role: Role): string {
  return role[0].toUpperCase() + role.slice(1)
}
