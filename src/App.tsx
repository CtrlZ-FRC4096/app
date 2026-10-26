import { createElement, lazy, Suspense, useEffect } from 'react'
import { modules } from './modules'
import { ROLES, canOpen, useSession } from './core/session'
import { href, useRoute } from './core/router'
import { resetAllStores } from './core/store'
import { toast, useToast } from './core/toast'
import { ErrorBoundary } from './core/ErrorBoundary'
import { Home } from './core/pages/Home'
import { Message } from './core/pages/Message'

const CONTRIBUTING = 'https://github.com/CtrlZ-FRC4096/app/blob/main/CONTRIBUTING.md'

// Each module's page is loaded only when someone opens it.
const pages = new Map(modules.map((m) => [m.id, lazy(m.load)]))

export default function App() {
  const session = useSession()
  const { id } = useRoute()
  const visible = modules.filter((m) => canOpen(session.role, m.roles))

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  return (
    <>
      <header className="app-header">
        <div className="wrap gutter">
          <a className="brand" href="#/" aria-label="Ctrl-Z Team App home">
            <span className="keys" aria-hidden="true"><span className="key">Ctrl</span><span className="key">Z</span></span>
            <span className="brand-name">Team App<small>FRC 4096</small></span>
          </a>
          <div className="header-tools">
            <div className="role-switch">
              <span>View as</span>
              <div className="seg" role="group" aria-label="View as">
                {ROLES.map((role) => (
                  <button key={role} type="button" aria-pressed={session.role === role} onClick={() => session.setRole(role)}>
                    {role[0].toUpperCase() + role.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">{session.name.split(' ').map((part) => part[0]).join('')}</span>
              <span>{session.name}</span>
            </div>
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
          <strong>Work in progress.</strong>
          <span className="muted">Example data only. Sign-in is a demo, and changes are saved only in this browser.</span>
          <button type="button" className="link-btn" onClick={() => { resetAllStores(); toast('Example data reset.') }}>Reset example data</button>
          <a href={CONTRIBUTING} target="_blank" rel="noopener">How to contribute</a>
        </div>
      </div>
      <main className="wrap gutter" id="main">
        <Page id={id} />
      </main>
      <ToastHost />
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
