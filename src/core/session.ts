/**
 * Who is signed in.
 *
 * In live mode, everyone signs in with Slack, and their role comes from the
 * members table. In demo mode there is no sign-in: the "View as" switch
 * picks one of the made-up people instead.
 *
 * Pages use useSession() for the signed-in person's name and role, and
 * data.ts files can use currentUser(). Both only work once someone is
 * signed in, which App.tsx makes sure of before showing any page.
 *
 * Hiding a button is not security. The database's permission rules decide
 * what each role can read and change. These checks only keep the screens
 * tidy.
 */
import { createStore, useStore } from './store'
import { isLive, signInError, supabase } from './supabase'
import { demoRole, demoUserId, useDemoRole } from './demo'
import { membersTable, type Member } from './members'
import type { Role } from './roles'

export { ROLES, canOpen, isAdmin, isMentor, roleName, type Role } from './roles'

export interface User {
  id: string
  name: string
  role: Role
  /** Their Slack picture, if they have one. */
  avatarUrl: string | null
}

/** Whether someone has signed in with Slack. Always signed in, in demo mode. */
export type SignIn =
  | { status: 'checking' }
  | { status: 'signed-out'; error: string | null }
  | { status: 'signed-in'; userId: string }

/** Whether the signed-in person can use the app. */
export type Access = { status: 'ok'; user: User } | { status: 'no-access'; name: string | null; reason: string }

const signInStore = createStore<SignIn>(
  'sign-in',
  1,
  () => (isLive ? { status: 'checking' } : { status: 'signed-in', userId: '' }),
  { keepOnReset: true, persist: false },
)

// Where to go back to after signing in.
const RETURN_TO = 'ctrlz-app:return-to'

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    // Only record what happened here: Supabase asks that nothing in this
    // callback waits on another Supabase call.
    const current = signInStore.get()
    if (session) {
      if (current.status !== 'signed-in' || current.userId !== session.user.id) {
        signInStore.set({ status: 'signed-in', userId: session.user.id })
      }
    } else {
      signInStore.set({ status: 'signed-out', error: current.status === 'checking' ? signInError : null })
    }
    if (event === 'SIGNED_IN') returnToPage()
  })
}

/** For App.tsx: has someone signed in with Slack yet? */
export function useSignIn(): SignIn {
  return useStore(signInStore)
}

/**
 * For App.tsx: can the signed-in person use the app? In live mode the page
 * waits for the member list to load.
 */
export function useAccess(): Access {
  const signIn = useStore(signInStore)
  const role = useDemoRole()
  const members = membersTable.useRows()
  return findAccess(signIn, role, members)
}

/** The signed-in person, for pages. */
export function useSession(): User {
  const access = useAccess()
  if (access.status !== 'ok') throw new Error('useSession() only works on pages shown after signing in.')
  return access.user
}

/** The signed-in person, for code outside components (data.ts files). Null if nobody is. */
export function currentUser(): User | null {
  const access = findAccess(signInStore.get(), demoRole(), membersTable.rows())
  return access.status === 'ok' ? access.user : null
}

export function findAccess(signIn: SignIn, role: Role, members: Member[], live = isLive): Access {
  if (!live) {
    const id = demoUserId(role)
    const me = members.find((m) => m.id === id)
    return { status: 'ok', user: { id, name: me?.name ?? 'Demo user', role, avatarUrl: null } }
  }
  if (signIn.status !== 'signed-in') return { status: 'no-access', name: null, reason: 'Sign in to use the team app.' }
  const me = members.find((m) => m.id === signIn.userId)
  if (!me) {
    return {
      status: 'no-access',
      name: null,
      reason: "You signed in, but you're not on the team list. Sign out and sign in again with the Ctrl-Z Slack workspace. If that doesn't work, ask a mentor.",
    }
  }
  if (!me.active) {
    return {
      status: 'no-access',
      name: me.name,
      reason: "Your access to the team app is switched off. If you're still on the team, ask a mentor to switch it back on.",
    }
  }
  return { status: 'ok', user: { id: me.id, name: me.name, role: me.role, avatarUrl: me.avatar_url } }
}

/** Send the person to Slack to sign in. They come back to the page they were on. */
export async function signInWithSlack() {
  if (!supabase) return
  try {
    sessionStorage.setItem(RETURN_TO, location.hash)
  } catch {
    // Without storage they land on the home page, which is fine.
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'slack_oidc',
    options: { redirectTo: location.origin + location.pathname },
  })
  if (error) signInStore.set({ status: 'signed-out', error: `Couldn't start signing in: ${error.message}` })
}

export async function signOut() {
  if (!supabase) return
  // Only this browser: signing out of a shared pit laptop shouldn't sign you out of your phone.
  await supabase.auth.signOut({ scope: 'local' })
  signInStore.set({ status: 'signed-out', error: null })
}

function returnToPage() {
  try {
    const hash = sessionStorage.getItem(RETURN_TO)
    sessionStorage.removeItem(RETURN_TO)
    if (hash && hash !== location.hash) location.hash = hash
  } catch {
    // Stay on the home page.
  }
}
