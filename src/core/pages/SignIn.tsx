import { useState } from 'react'
import { signInWithSlack, signOut, useSwitching } from '../session'
import { Callout, PageHead, Panel } from '../ui'

/** Shown to anyone who isn't signed in, in live mode. */
export function SignIn({ error }: { error: string | null }) {
  const [leaving, setLeaving] = useState(false)
  const switching = useSwitching()

  function start() {
    setLeaving(true)
    void signInWithSlack().finally(() => setLeaving(false))
  }

  return (
    <div className="signin">
      <PageHead title="Sign in">
        The team app is for members of Ctrl-Z. Sign in with your Ctrl-Z Slack account.
      </PageHead>
      {error && (
        <Callout title="That didn't work">
          <span>{error}</span>
        </Callout>
      )}
      <Panel>
        <div className="panel-body">
          <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={leaving}>
            {leaving ? 'Opening Slack…' : 'Sign in with Slack'}
          </button>
          <p className="note">
            The first time you sign in, you start as a student. A mentor can change your role. The app only uses your
            name and picture from Slack.
          </p>
        </div>
      </Panel>
      <SharedComputer open={switching} />
    </div>
  )
}

/** Where people sign out of Slack in a web browser. */
const SLACK_IN_BROWSER = 'https://app.slack.com/'

/**
 * How to sign in on a computer someone else used. Slack signs in whoever is
 * signed in to Slack in this browser, and can't be asked to pick someone
 * else, so they sign out of Slack first. Open after Switch user.
 */
export function SharedComputer({ open }: { open: boolean }) {
  return (
    <Panel>
      <details open={open}>
        <summary style={{ cursor: 'pointer', minHeight: 44, padding: '10px 16px' }}>
          <strong>Someone else used Slack on this computer?</strong>
        </summary>
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <p style={{ margin: 0 }}>
            Slack signs in whoever is signed in to Slack in this browser. To sign in as yourself:
          </p>
          <ol style={{ margin: 0, paddingLeft: '1.4em', display: 'grid', gap: 6 }}>
            <li>
              Open <a href={SLACK_IN_BROWSER} target="_blank" rel="noopener">Slack in this browser ↗</a>.
            </li>
            <li>If it shows someone else, tap their profile picture, then <strong>Sign out</strong> of the Ctrl-Z workspace.</li>
            <li>Come back to this tab, tap <strong>Sign in with Slack</strong>, and sign in to Slack as yourself.</li>
          </ol>
          <p className="note" style={{ margin: 0 }}>
            Or use a private window (incognito in Chrome). It forgets who signed in when you close it, so the next person
            starts fresh. When you're done on a shared computer, tap your picture at the top right, then Switch user.
          </p>
        </div>
      </details>
    </Panel>
  )
}

/** Shown to someone who signed in but can't use the app, such as after their access was switched off. */
export function NoAccess({ name, reason }: { name: string | null; reason: string }) {
  return (
    <div className="signin">
      <PageHead title={name ? `Hi ${name.split(' ')[0]}` : "You're signed in"}>
        {reason}
      </PageHead>
      <p>
        <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
      </p>
    </div>
  )
}

/** Shown for a moment while the app checks whether someone is signed in. */
export function Checking() {
  return <p className="muted signin">Checking who you are…</p>
}
