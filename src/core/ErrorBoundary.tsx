/**
 * Keeps one broken module from taking down the whole app. If a module's page
 * throws while it draws, this shows what went wrong in that module only, and
 * every other module keeps working.
 */
import { Component, Suspense, type ReactNode } from 'react'

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
