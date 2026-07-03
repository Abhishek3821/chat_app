import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Catches render errors so a single misbehaving screen never white-screens the app.
 *
 * IMPORTANT: pass a `resetKey` (e.g. the current route pathname). When it changes,
 * the boundary clears its error automatically — so navigating away RECOVERS the
 * app instead of leaving it stuck on the error screen with dead navigation.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  // When the resetKey changes (route navigation), drop the error and re-render children.
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ChatConnect render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-full min-h-[60vh] place-items-center bg-[rgb(var(--app-bg))] p-6 text-center">
          <div className="glass-strong max-w-md rounded-3xl p-8 shadow-soft-lg">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10 text-red-500">
              <AlertTriangle size={26} />
            </div>
            <h1 className="text-lg font-bold text-content">Something went sideways</h1>
            <p className="mt-1.5 text-sm text-content-muted">
              An unexpected error occurred while rendering this screen. Try another tab, or reload.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                onClick={() => this.setState({ error: null })}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-content hover:bg-content/5"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.assign('/')}
                className="btn-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
              >
                <RotateCcw size={16} /> Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
