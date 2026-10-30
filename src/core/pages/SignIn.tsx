import { useState } from 'react'
import { signInWithSlack, signOut } from '../session'
import { Callout, PageHead, Panel } from '../ui'

/** Shown to anyone who isn't signed in, in live mode. */
export function SignIn({ error }: { error: string | null }) {
  const [leaving, setLeaving] = useState(false)

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
    </div>
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
