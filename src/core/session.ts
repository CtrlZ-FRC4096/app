/**
 * Who is signed in. DEMO ONLY.
 *
 * For now anyone can pick a role with the "View as" switch, so the team can
 * see what students, mentors and admins each get. When Slack sign-in is set
 * up, this file is replaced by one that reads the signed-in user from
 * Supabase, and the switch goes away. Pages only use useSession() and
 * currentUser(), so they won't need to change.
 *
 * Hiding a button is not security. Once there is a database, the database
 * rules decide what each role can read and change. These checks only keep
 * the screens tidy.
 */
import { createStore, useStore } from './store'

export type Role = 'student' | 'mentor' | 'admin'
export const ROLES: Role[] = ['student', 'mentor', 'admin']

export interface User {
  name: string
  role: Role
}

const DEMO_NAMES: Record<Role, string> = {
  student: 'Alex Rivera',
  mentor: 'Pat Chen',
  admin: 'Morgan Lee',
}

const roleStore = createStore<Role>('demo-role', 1, () => 'student', { keepOnReset: true })

export function useSession(): User & { setRole: (role: Role) => void } {
  const role = useStore(roleStore)
  return { name: DEMO_NAMES[role], role, setRole: (next) => roleStore.set(next) }
}

/** The signed-in user, for code outside components (data.ts files). */
export function currentUser(): User {
  const role = roleStore.get()
  return { name: DEMO_NAMES[role], role }
}

/** Mentors and admins see costs, edit items and sign off skills. */
export function isMentor(role: Role): boolean {
  return role === 'mentor' || role === 'admin'
}

export function canOpen(role: Role, allowed?: Role[]): boolean {
  return !allowed || allowed.includes(role)
}
