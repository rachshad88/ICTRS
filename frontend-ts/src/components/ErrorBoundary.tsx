import { Component, type ErrorInfo, type ReactNode } from 'react';
import { queryClient } from '../services/queryClient';

// Catches a render crash so it doesn't take the whole site down with a blank screen.
//  - variant "page": inside the signed-in layout (App.tsx), so the sidebar and topbar keep
//    working and only the page area shows the message. A new `resetKey` (the path) clears it.
//  - variant "site": the last resort around everything; offers a reload.
// A page file that failed to download after a redeploy is normally reloaded in main.tsx
// (vite:preloadError); if that was not possible, it lands here too and Reload fixes it.

interface Props {
  variant: 'page' | 'site';
  resetKey?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  // Bad data is the usual cause. The crashed page's queries lost their screen, so they are now
  // inactive: drop those cached results so it loads fresh instead of re-rendering the same data.
  private retry = () => {
    queryClient.removeQueries({ type: 'inactive' });
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.variant === 'page') {
      return (
        <div className="page-wrap app-crash" role="alert">
          <div className="page-header">
            <h2>This page hit a problem</h2>
          </div>
          <p>
            Something went wrong while showing it. Nothing you saved was lost, and the rest of ITRS still works:
            try again, or pick another page from the menu.
          </p>
          <div className="app-crash-actions">
            <button type="button" className="btn-primary" onClick={this.retry}>Try again</button>
            <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Reload ITRS</button>
          </div>
        </div>
      );
    }

    return (
      <div className="app-crash app-crash-site" role="alert">
        <img src="/solano-logo.png" alt="" />
        <h1>Something went wrong</h1>
        <p>ITRS ran into a problem and couldn&apos;t show this page. Reloading usually fixes it.</p>
        <div className="app-crash-actions">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload ITRS</button>
          <a className="btn-secondary" href="/">Go to the home page</a>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
