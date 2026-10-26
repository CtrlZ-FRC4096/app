/**
 * Demo mode: the made-up people in the example data, and the "View as"
 * switch that lets anyone try the app as a student, mentor or admin.
 *
 * Demo mode is how the app runs on your computer and in tests, and on the
 * live site until the team database is set up. See src/core/supabase.ts.
 */
import { createStore, useStore } from './store'
import type { Role } from './roles'

/** Ids of the made-up people. Use these for created_by in example rows. */
export const DEMO_PEOPLE = {
  alex: '00000000-0000-4000-8000-00000000a1e7',
  pat: '00000000-0000-4000-8000-0000000000fa',
  morgan: '00000000-0000-4000-8000-00000000304a',
  jordan: '00000000-0000-4000-8000-00000000d0a0',
  sam: '00000000-0000-4000-8000-0000000005a3',
} as const

/** Who you are in demo mode when you view the app as each role. */
const DEMO_USER: Record<Role, string> = {
  student: DEMO_PEOPLE.alex,
  mentor: DEMO_PEOPLE.pat,
  admin: DEMO_PEOPLE.morgan,
}

const roleStore = createStore<Role>('demo-role', 1, () => 'student', { keepOnReset: true })

export function useDemoRole(): Role {
  return useStore(roleStore)
}

export function demoRole(): Role {
  return roleStore.get()
}

export function setDemoRole(role: Role) {
  roleStore.set(role)
}

/** The id of the made-up person you are right now in demo mode. */
export function demoUserId(role: Role = roleStore.get()): string {
  return DEMO_USER[role]
}
