/**
 * The last line between a render throw and a white screen.
 *
 * React unmounts the whole tree when a render throws with no boundary above it, which
 * turns one bad message into a blank tab with the only evidence in a console nobody
 * has open. This catches it, says so, and offers the two exits that always exist:
 * try rendering again, or reload the app.
 */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('render failed', error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>Something broke</h1>
          <p className="muted">
            The view hit an error it couldn’t recover from. Your messages are safe on
            the server.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => this.setState({ failed: false })}
            >
              Try again
            </button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
