'use client';

import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Custom fallback. If omitted, a default error card is shown. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React error boundary that catches render-time errors in its subtree.
 * Wrap each major section independently so one failure doesn't blank the page.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production this is where Sentry.captureException would go.
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <SectionError message={this.state.error.message} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

/**
 * Default error card shown inside an ErrorBoundary when no custom fallback
 * is provided. Also used as a standalone error state in pages.
 */
export function SectionError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-zinc-400" />
      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Something went wrong</p>
        {message && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">{message}</p>
        )}
      </div>
      {onRetry && (
        <button
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      )}
    </div>
  );
}
