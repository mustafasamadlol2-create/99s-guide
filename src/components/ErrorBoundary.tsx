import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const isDevelopment = Boolean(
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV,
);

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isDevelopment) {
      console.error("[UI ErrorBoundary]", error, errorInfo.componentStack);
    } else {
      // Keep production diagnostics intentionally minimal. Do not print raw
      // exception text, paths, or component data that may contain user input.
      console.error("[UI ErrorBoundary] render failure", error.name);
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center min-h-screen bg-med-bg dark:bg-[#000000] text-neutral-900 dark:text-white p-6"
          role="alert"
          aria-live="assertive"
        >
          <div className="bg-white dark:bg-[#1C1C1E] p-8 rounded-2xl shadow-elevation-3 max-w-md w-full text-center border border-med-beige/30 dark:border-white/10">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold mb-3 tracking-tight">Something went wrong</h1>
            <p className="text-med-muted dark:text-neutral-400 mb-8 text-sm">
              We encountered an unexpected error. Please refresh the application to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-2 bg-neutral-900 text-white dark:bg-white dark:text-[#111827] px-6 py-3 rounded-xl font-semibold transition hover:scale-[1.02] active:scale-[0.98]"
            >
              <RefreshCw className="w-5 h-5" />
              Reload Application
            </button>
            {isDevelopment && this.state.error && (
              <div className="mt-6 p-4 bg-neutral-100 dark:bg-neutral-900 rounded-lg text-left overflow-x-auto text-xs font-mono text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-800">
                {this.state.error.message}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
