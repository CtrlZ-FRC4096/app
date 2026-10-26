import { createElement, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { modules } from './modules'
import { ROLES, canOpen, roleName, signOut, useAccess, useSession, useSignIn, type User } from './core/session'
import { isLive } from './core/supabase'
import { setDemoRole } from './core/demo'
import { initials } from './core/members'
import { href, useRoute } from './core/router'
import { resetAllStores } from './core/store'
import { toast, useToast } from './core/toast'
import { ErrorBoundary } from './core/ErrorBoundary'
import { Home } from './core/pages/Home'
import { Message } from './core/pages/Message'
import { Checking, NoAccess, SignIn } from './core/pages/SignIn'

const CONTRIBUTING = 'https://github.com/CtrlZ-FRC4096/app/blob/main/CONTRIBUTING.md'

// Each module's page is loaded only when someone opens it.
const pages = new Map(modules.map((m) => [m.id, lazy(m.load)]))

export default function App() {
  const signIn = useSignIn()
  let body: ReactNode
  if (signIn.status === 'checking') body = <Frame><Checking /></Frame>
  else if (signIn.status === 'signed-out') body = <Frame><SignIn error={signIn.error} /></Frame>
  else {
    // In live mode the member list loads first: it says who you are and what you can open.
    body = (
      <Suspense fallback={<Frame><Checking /></Frame>}>
        <ErrorBoundary moduleName="The team app">
          <Gate />
        </ErrorBoundary>
      </Suspense>
    )
  }
  return (
    <>
      {body}
      <ToastHost />
    </>
  )
}

function Gate() {
  const access = useAccess()
  if (access.status !== 'ok') return <Frame><NoAccess name={access.name} reason={access.reason} /></Frame>
  return <Shell user={access.user} />
}

function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Ctrl-Z Team App home">
      <span className="keys" aria-hidden="true"><span className="key">Ctrl</span><span className="key">Z</span></span>
      <span className="brand-name">Team App<small>FRC 4096</small></span>
    </a>
  )
}

/** The page around the sign-in screens: just the header. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="app-header">
        <div className="wrap gutter header-only"><Brand /></div>
      </header>
      <main className="wrap gutter" id="main">{children}</main>
    </>
  )
}

function Shell({ user }: { user: User }) {
  const { id } = useRoute()
  const visible = modules.filter((m) => canOpen(user.role, m.roles))

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  return (
    <>
      <header className="app-header">
        <div className="wrap gutter">
          <Brand />
          <div className="header-tools">
            {!isLive && (
              <div className="role-switch">
                <span>View as</span>
                <div className="seg" role="group" aria-label="View as">
                  {ROLES.map((role) => (
                    <button key={role} type="button" aria-pressed={user.role === role} onClick={() => setDemoRole(role)}>
                      {roleName(role)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="user-chip">
              {user.avatarUrl ? (
                <img className="avatar" src={user.avatarUrl} alt="" />
              ) : (
                <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
              )}
              <span>{user.name}</span>
            </div>
            {isLive && <button type="button" className="link-btn" onClick={() => void signOut()}>Sign out</button>}
          </div>
          <nav className="nav" aria-label="Modules">
            <a href="#/" aria-current={id === '' ? 'page' : undefined}>Home</a>
            {visible.map((m) => (
              <a key={m.id} href={href(m.id)} aria-current={id === m.id ? 'page' : undefined}>{m.name}</a>
            ))}
          </nav>
        </div>
      </header>
      <div className="banner">
        <div className="wrap gutter">
          {isLive ? (
            <>
              <strong>Work in progress.</strong>
              <span className="muted">Students are building this app. Found a problem or have an idea?</span>
            </>
          ) : (
            <>
              <strong>Demo mode.</strong>
              <span className="muted">Example data only, saved in this browser. Use "View as" to try each role.</span>
              <button type="button" className="link-btn" onClick={() => { resetAllStores(); toast('Example data reset.') }}>Reset example data</button>
            </>
          )}
          <a href={CONTRIBUTING} target="_blank" rel="noopener">How to contribute</a>
        </div>
      </div>
      <main className="wrap gutter" id="main">
        <Page id={id} />
      </main>
    </>
  )
}

function Page({ id }: { id: string }) {
  const { role } = useSession()
  if (id === '') return <Home />
  const module = modules.find((m) => m.id === id)
  if (!module) return <Message title="Page not found">There's no module called "{id}". It may have been renamed.</Message>
  if (!canOpen(role, module.roles)) return <Message title="Not available">Your role can't open {module.name}. Ask a mentor if you need it.</Message>
  return (
    <ErrorBoundary key={module.id} moduleName={module.name}>
      <Suspense fallback={<p className="muted">Loading {module.name}…</p>}>
        {createElement(pages.get(module.id)!)}
      </Suspense>
    </ErrorBoundary>
  )
}

function ToastHost() {
  const current = useToast()
  return (
    <div className="toast" role="status" aria-live="polite" hidden={!current}>
      {current?.text}
    </div>
  )
}
