import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/** Catches render errors so a single misbehaving screen never white-screens the app. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ChatConnect render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-[100dvh] place-items-center bg-[rgb(var(--app-bg))] p-6 text-center">
          <div className="glass-strong max-w-md rounded-3xl p-8 shadow-soft-lg">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10 text-red-500">
              <AlertTriangle size={26} />
            </div>
            <h1 className="text-lg font-bold text-content">Something went sideways</h1>
            <p className="mt-1.5 text-sm text-content-muted">
              An unexpected error occurred while rendering this screen. Reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.assign('/')}
              className="btn-gradient mx-auto mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
            >
              <RotateCcw size={16} /> Back to ChatConnect
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
