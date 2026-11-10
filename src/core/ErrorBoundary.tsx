/**
 * Keeps one broken module from taking down the whole app. If a module's page
 * throws while it draws, this shows what went wrong in that module only, and
 * every other module keeps working.
 */
import { Component, Suspense, type ReactNode } from 'react'
import { isUpdateError } from './updates'

interface Props {
  moduleName: string
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    // Not a bug: the app was updated, or this page isn't saved on the device
    // and there's no connection. A reload fixes it; "Try again" can't.
    if (isUpdateError(this.state.error)) {
      const offline = navigator.onLine === false
      return (
        <div className="callout" role="alert">
          <strong>{offline ? `${this.props.moduleName} can't open with no connection` : 'A new version of the app is out'}</strong>
          <p style={{ margin: 0 }}>
            {offline
              ? "This page isn't saved on this device yet. Reload once you're back online. Anything you've saved is still here."
              : 'Reload to get it. Anything you saved, like scouting entries, stays saved.'}
          </p>
          <div className="toolbar">
            <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      )
    }
    return (
      <div className="crash" role="alert">
        <h2>{this.props.moduleName} stopped working</h2>
        <p>The rest of the app is fine. If you were changing this module, the error below says what broke. Otherwise, tell whoever is working on it.</p>
        <pre>{this.state.error.message}</pre>
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
          <a className="btn" href="#/">Go to the home page</a>
        </div>
      </div>
    )
  }
}

/**
 * For small extras like a home page tile's status: while it loads or if it
 * breaks, it shows nothing, and the rest of the page carries on.
 */
export class QuietBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) return null
    return <Suspense fallback={null}>{this.props.children}</Suspense>
  }
}
