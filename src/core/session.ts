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
 * With no connection, the sign-in can't be checked, so the app opens as the
 * last person signed in on this device, with the member list kept on the
 * device (offline.ts). Signing out forgets both.
 *
 * On a shared computer, "Switch user" in the account menu signs out of the
 * app so someone else can sign in. Slack signs in whoever is signed in to
 * Slack in that browser, and has no way to ask "which account?", so the
 * sign-in page shows how to sign out of Slack first. If Slack signs the same
 * person straight back in, the app signs them out again and says why
 * (checkSwitch()).
 *
 * Hiding a button is not security. The database's permission rules decide
 * what each role can read and change. These checks only keep the screens
 * tidy. That's true offline too: nothing reaches the database until the
 * device is back online and the sign-in is checked again.
 */
import { createStore, useStore } from './store'
import { isLive, signInError, supabase } from './supabase'
import { demoRole, demoUserId, useDemoRole } from './demo'
import { membersTable, type Member } from './members'
import { isOnline, useOnline } from './offline'
import { forgetOfflineCopies } from './table'
import type { Role } from './roles'

export { ROLES, canOpen, isAdmin, isLeader, isMentor, roleName, type Role } from './roles'

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

// Who tapped Switch user, kept until the next sign-in comes back from Slack.
const SWITCHED_FROM = 'ctrlz-app:switched-from'

/**
 * Whether the sign-in page should show the steps for a shared computer
 * open: after Switch user, or when Slack signed the same person back in.
 */
const switchingStore = createStore<boolean>('switching-user', 1, () => false, { keepOnReset: true, persist: false })

/** For the sign-in page: did someone just tap Switch user? */
export function useSwitching(): boolean {
  return useStore(switchingStore)
}

/** Said when Slack signs the same person back in after Switch user. */
export const SAME_PERSON =
  'Slack signed in the same person as before, because Slack in this browser is still signed in as them. ' +
  'Sign out of Slack first (the steps are below), then tap Sign in with Slack again. ' +
  'If you did mean to sign in as the same person, just tap Sign in with Slack again.'

/**
 * After Switch user, whether the sign-in that came back from Slack is the
 * same person who switched away: then Slack didn't let anyone else in.
 * Gives the message to show, or null if it's fine.
 */
export function checkSwitch(switchedFrom: string | null, signedIn: string): string | null {
  return switchedFrom !== null && switchedFrom === signedIn ? SAME_PERSON : null
}

/** Who tapped Switch user, and forget it: it's only checked once. */
function takeSwitchedFrom(): string | null {
  try {
    const id = sessionStorage.getItem(SWITCHED_FROM)
    sessionStorage.removeItem(SWITCHED_FROM)
    return id
  } catch {
    return null
  }
}

// Who signed in last on this device, so the app can open with no connection.
const lastSignIn = createStore<string | null>('last-sign-in', 1, () => null, { keepOnReset: true })

/**
 * The sign-in to go by. With no connection it can't be checked: use the last
 * person signed in on this device, if there is one.
 */
export function effectiveSignIn(signIn: SignIn, online: boolean, last: string | null): SignIn {
  if (!online && last && signIn.status !== 'signed-in') return { status: 'signed-in', userId: last }
  return signIn
}

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    // Only record what happened here: Supabase asks that nothing in this
    // callback waits on another Supabase call.
    const current = signInStore.get()
    if (session) {
      if (lastSignIn.get() !== session.user.id) lastSignIn.set(session.user.id)
    } else if (isOnline()) {
      // Really signed out. (Offline, the sign-in just couldn't be checked.)
      lastSignIn.set(null)
    }
    if (session) {
      if (current.status !== 'signed-in' || current.userId !== session.user.id) {
        signInStore.set({ status: 'signed-in', userId: session.user.id })
      }
    } else {
      signInStore.set({ status: 'signed-out', error: current.status === 'checking' ? signInError : null })
    }
    if (event === 'SIGNED_IN') {
      const problem = session ? checkSwitch(takeSwitchedFrom(), session.user.id) : null
      if (problem) {
        // Not inside this callback (see above): straight after it.
        setTimeout(() => void signOut().then(() => {
          switchingStore.set(true)
          signInStore.set({ status: 'signed-out', error: problem })
        }))
        return
      }
      switchingStore.set(false)
      returnToPage()
    }
  })
  // Back online: check the sign-in straight away, instead of waiting for
  // Supabase's next try, so anything waiting to send can go.
  globalThis.addEventListener?.('online', () => {
    void supabase?.auth.refreshSession().catch(() => {})
  })
}

/** Call `listener` whenever someone is signed in (again), like after the connection comes back. Gives back a function to stop. */
export function onSignedIn(listener: () => void): () => void {
  return signInStore.subscribe(() => {
    if (signInStore.get().status === 'signed-in') listener()
  })
}

/** For App.tsx: has someone signed in with Slack yet? */
export function useSignIn(): SignIn {
  return effectiveSignIn(useStore(signInStore), useOnline(), useStore(lastSignIn))
}

/**
 * For App.tsx: can the signed-in person use the app? In live mode the page
 * waits for the member list to load.
 */
export function useAccess(): Access {
  const signIn = useSignIn()
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
  const signIn = effectiveSignIn(signInStore.get(), isOnline(), lastSignIn.get())
  const access = findAccess(signIn, demoRole(), membersTable.rows())
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
  // Forget who this is, and the copies kept for using the app offline.
  lastSignIn.set(null)
  forgetOfflineCopies()
  signInStore.set({ status: 'signed-out', error: null })
}

/**
 * Sign out of the app so someone else can sign in on this computer. The
 * sign-in page then shows how to sign out of Slack in this browser too.
 */
export async function switchUser() {
  const me = currentUser()
  try {
    if (me) sessionStorage.setItem(SWITCHED_FROM, me.id)
  } catch {
    // Without storage the same-person check is skipped, which is fine.
  }
  await signOut()
  switchingStore.set(true)
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
