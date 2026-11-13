import { createElement, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { modules } from './modules'
import { ROLES, canOpen, roleName, signOut, switchUser, useAccess, useSession, useSignIn, type User } from './core/session'
import { isLive } from './core/supabase'
import { setDemoRole } from './core/demo'
import { initials } from './core/members'
import { groupModules } from './core/registry'
import { href, useRoute } from './core/router'
import { resetAllStores } from './core/store'
import { toast, useToast } from './core/toast'
import { ErrorBoundary, QuietBoundary } from './core/ErrorBoundary'
import { loadPage } from './core/updates'
import { Home } from './core/pages/Home'
import { Message } from './core/pages/Message'
import { Notifications } from './core/pages/Notifications'
import { badgeText, bellLabel, useUnreadCount } from './core/notifications'
import { Checking, NoAccess, SignIn } from './core/pages/SignIn'

const CONTRIBUTING = 'https://github.com/CtrlZ-FRC4096/app/blob/main/CONTRIBUTING.md'

// Each module's page is loaded only when someone opens it. If its file is
// gone because a new version went live, loadPage reloads to get it.
const pages = new Map(modules.map((m) => [m.id, lazy(loadPage(m.load))]))

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

/** The team's logo, which is the whole of the top bar on the left. It goes home. */
function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Ctrl-Z, home">
      {/* The mark from the team wiki. styles.css paints it, so it works on a light or a dark page. */}
      <span className="logo" aria-hidden="true" />
    </a>
  )
}

/** The page around the sign-in screens: just the logo. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="app-header">
        <div className="wrap gutter topbar"><Brand /></div>
      </header>
      <main className="wrap gutter" id="main">{children}</main>
    </>
  )
}

function Shell({ user }: { user: User }) {
  const { id, rest } = useRoute()
  // The page inside the module, like 'pit' in #/scouting/pit, or '' for none.
  const subpage = rest[0] ?? ''
  const groups = groupModules(modules.filter((m) => canOpen(user.role, m.roles)))
  /*
   * Which menu is open: its name (a group's id, or 'account') together with
   * the page we were on when it opened. Only one menu is open at a time, and
   * because the page is remembered with it, opening a module, or a page
   * inside one, closes the menu by itself.
   */
  const page = `${id}/${subpage}`
  const [menu, setMenu] = useState({ name: '', page: '' })
  const openMenu = menu.page === page ? menu.name : ''
  /*
   * Which module's list of pages is open inside a menu (like Scouting's
   * Match and Pit): a module id, or '' for none. Like the menu above, it
   * remembers the page it opened on, so it closes when the page changes,
   * and it closes whenever its menu closes.
   */
  const [pages, setPages] = useState({ id: '', page: '' })
  const openPages = pages.page === page ? pages.id : ''

  /*
   * When the page changes, close every menu for good. Without this, going
   * from Pit to Match and back to Pit (with the switch on the page) would
   * reopen a menu that was open on Pit, because it remembered that page.
   * React's way to do this is to check while drawing, not in an effect:
   * https://react.dev/learn/you-might-not-need-an-effect
   */
  const [lastPage, setLastPage] = useState(page)
  if (lastPage !== page) {
    setLastPage(page)
    setMenu({ name: '', page })
    setPages({ id: '', page })
  }

  function setOpenPages(moduleId: string) {
    setPages({ id: moduleId, page })
  }

  function toggle(name: string) {
    setMenu({ name: openMenu === name ? '' : name, page })
    setOpenPages('')
  }

  function close() {
    setMenu({ name: '', page })
    setOpenPages('')
  }

  // Every page starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  // A tap or click anywhere outside a menu closes it.
  useEffect(() => {
    if (!openMenu) return
    function closeIfOutside(event: Event) {
      if (!(event.target as Element | null)?.closest('.menu')) {
        setMenu({ name: '', page: '' })
        setPages({ id: '', page: '' })
      }
    }
    document.addEventListener('pointerdown', closeIfOutside)
    return () => document.removeEventListener('pointerdown', closeIfOutside)
  }, [openMenu])

  return (
    <>
      <a className="skip-link" href="#main">Skip to the page</a>
      <header className="app-header">
        <div className="wrap gutter topbar">
          <Brand />
          <nav className="nav" aria-label="Sections">
            <a className="nav-link" href="#/" aria-current={id === '' ? 'page' : undefined}>Home</a>
            {groups.map((group) => (
              <Menu
                key={group.id}
                panelId={`menu-${group.id}`}
                label={group.name}
                current={group.modules.some((m) => m.id === id)}
                open={openMenu === group.id}
                onToggle={() => toggle(group.id)}
                onClose={close}
              >
                {group.modules.map((m) => m.pages ? (
                  // A module with pages: its name opens and closes a list of them.
                  <div key={m.id} className="menu-pages">
                    <button
                      type="button"
                      className="menu-item menu-pages-btn"
                      aria-expanded={openPages === m.id}
                      aria-controls={`menu-pages-${m.id}`}
                      onClick={() => setOpenPages(openPages === m.id ? '' : m.id)}
                    >
                      <span className="menu-item-name">{m.name}</span>
                      <span className="chev" aria-hidden="true" />
                    </button>
                    <div id={`menu-pages-${m.id}`} className="menu-pages-list" hidden={openPages !== m.id}>
                      {m.pages.map((p) => (
                        <a key={p.path} className="menu-item" href={href(m.id, p.path)} aria-current={m.id === id && p.path === subpage ? 'page' : undefined}>
                          <span className="menu-item-name">{p.name}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : (
                  <a key={m.id} className="menu-item" href={href(m.id)} aria-current={m.id === id ? 'page' : undefined}>
                    <span className="menu-item-name">{m.name}</span>
                  </a>
                ))}
              </Menu>
            ))}
          </nav>
          {/* Notifications come from the team database: with no connection, the bell just isn't shown. */}
          <QuietBoundary><Bell current={id === 'notifications'} /></QuietBoundary>
          <Menu
            className="account"
            panelId="menu-account"
            buttonLabel={`${user.name}, ${roleName(user.role)}`}
            label={user.avatarUrl
              ? <img className="avatar" src={user.avatarUrl} alt="" />
              : <span className="avatar" aria-hidden="true">{initials(user.name)}</span>}
            open={openMenu === 'account'}
            onToggle={() => toggle('account')}
            onClose={close}
          >
            <p className="menu-head">
              <strong>{user.name}</strong>
              <span className="note">{roleName(user.role)}</span>
            </p>
            {isLive ? (
              <>
                {/* For shared computers: the sign-in page then shows how to sign out of Slack too. */}
                <button type="button" className="menu-item" onClick={() => void switchUser()}>
                  <span className="menu-item-name">Switch user</span>
                </button>
                <button type="button" className="menu-item" onClick={() => void signOut()}>
                  <span className="menu-item-name">Sign out</span>
                </button>
              </>
            ) : (
              <>
                <p className="eyebrow menu-label">View as</p>
                {ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className="menu-item"
                    aria-pressed={user.role === role}
                    onClick={() => { setDemoRole(role); close() }}
                  >
                    <span className="menu-item-name">{roleName(role)}</span>
                  </button>
                ))}
              </>
            )}
          </Menu>
        </div>
      </header>
      <Banner />
      <main className="wrap gutter" id="main">
        <Page id={id} />
      </main>
    </>
  )
}

/**
 * A button in the top bar with a panel of links under it. Shell remembers
 * which one is open, so opening one closes the last; Escape or a tap outside
 * closes it too.
 */
function Menu(props: {
  panelId: string
  /** What the button shows: a group's name, or the signed-in person's picture. */
  label: ReactNode
  /** Say what the button does when the label is a picture rather than words. */
  buttonLabel?: string
  /** True when the page you're on is in this menu, so the button can say so. */
  current?: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const button = useRef<HTMLButtonElement>(null)
  return (
    <div
      className={'menu' + (props.className ? ' ' + props.className : '')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !props.open) return
        props.onClose()
        button.current?.focus()
      }}
    >
      <button
        ref={button}
        type="button"
        className="menu-btn"
        aria-expanded={props.open}
        aria-controls={props.panelId}
        aria-label={props.buttonLabel}
        data-current={props.current ? '' : undefined}
        onClick={props.onToggle}
      >
        {props.label}
        <span className="chev" aria-hidden="true" />
      </button>
      <div className="menu-panel" id={props.panelId} hidden={!props.open}>
        {props.children}
      </div>
    </div>
  )
}

/** The bell at the top right: opens Notifications, with how many are new. See src/core/notifications.ts. */
function Bell(props: { current: boolean }) {
  const count = useUnreadCount()
  return (
    <a className="nav-link bell" href="#/notifications" aria-label={bellLabel(count)} aria-current={props.current ? 'page' : undefined}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && <span className="bell-count" aria-hidden="true">{badgeText(count)}</span>}
    </a>
  )
}

/** The one line under the top bar: what state the app is in, and how to help. */
function Banner() {
  return (
    <div className="banner">
      <div className="wrap gutter">
        {isLive ? (
          <>
            <strong>Work in progress.</strong>
            <span className="muted">Students are building this app. Found a problem or have an idea?</span>
            <a href={href('feedback')}>Send feedback</a>
          </>
        ) : (
          <>
            <strong>Demo mode.</strong>
            <span className="muted">Example data only, saved in this browser. Try each role from the menu at the top right.</span>
            <button type="button" className="link-btn" onClick={() => { resetAllStores(); toast('Example data reset.') }}>Reset example data</button>
            {/* Not "Send feedback": in demo mode it's only saved in this browser, so nobody on the team would see it. */}
            <a href={CONTRIBUTING} target="_blank" rel="noopener">How to contribute</a>
          </>
        )}
      </div>
    </div>
  )
}

function Page({ id }: { id: string }) {
  const { role } = useSession()
  if (id === '') return <Home />
  if (id === 'notifications') return <Notifications />
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
