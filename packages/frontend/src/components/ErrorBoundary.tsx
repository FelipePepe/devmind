import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short label shown in the fallback ("Builder", "Chat panel", …). */
  scope?: string;
  /** Optional custom fallback. Overrides the default UI. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic React error boundary. Without it, a single thrown render error
 * unmounts the whole tree and the user sees a blank page until they reload.
 *
 * Place one boundary around each independent area (chat panel, builder,
 * admin pages) so a crash there does not blank the topbar or the whole
 * app shell.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ''}]`, error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        style={{
          padding: '2rem',
          margin: '1rem',
          borderRadius: '8px',
          border: '1px solid var(--border, #d97757)',
          background: 'var(--bg-surface, #1c1a19)',
          color: 'var(--text-primary, #eeebe6)',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
          {this.props.scope ? `${this.props.scope} crashed` : 'Something went wrong'}
        </div>
        <div style={{ color: 'var(--text-tertiary, #999)', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error.message || 'Unknown error'}
        </div>
        <button
          type="button"
          onClick={this.reset}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '6px',
            border: '1px solid var(--accent, #d97757)',
            background: 'transparent',
            color: 'var(--accent, #d97757)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
