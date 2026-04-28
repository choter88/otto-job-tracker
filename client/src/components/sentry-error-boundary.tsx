import * as Sentry from "@sentry/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Wraps Sentry's ErrorBoundary with a local fallback that exposes the actual
 * error message + stack to the user in collapsible details. Without this,
 * runtime crashes only show "Something went wrong" with no way to copy the
 * stack — making remote debugging painful.
 *
 * The stack is logged to console.error too, so DevTools (Cmd+Option+I when
 * launched with OTTO_DEVTOOLS=1) shows it immediately.
 */
class LocalErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console (visible via DevTools or Electron's stderr)
    // eslint-disable-next-line no-console
    console.error("[OTTO RUNTIME ERROR]", error, info?.componentStack);
    this.setState({ componentStack: info?.componentStack || null });
  }

  reload = () => {
    window.location.reload();
  };

  copyStack = () => {
    const { error, componentStack } = this.state;
    const text = [
      `Otto runtime error — ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      "",
      `Message: ${error?.message ?? "(unknown)"}`,
      "",
      "Stack:",
      error?.stack ?? "(no stack)",
      "",
      "Component stack:",
      componentStack ?? "(none)",
    ].join("\n");
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback: open a prompt with the text so it's selectable.
      window.prompt("Copy this error and share it:", text);
    });
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center font-sans bg-background text-foreground">
        <div className="max-w-2xl w-full">
          <h1 className="text-2xl font-semibold mb-3">Something went wrong</h1>
          <p className="text-muted-foreground mb-5">
            An unexpected error occurred. Reload the app, or copy the details below
            and share them so we can diagnose.
          </p>

          <details className="text-left text-xs bg-card border border-border rounded-md p-3 mb-4 overflow-auto max-h-[40vh]">
            <summary className="cursor-pointer font-medium text-sm mb-2">
              Error details
            </summary>
            <div className="mt-2">
              <p className="font-medium text-sm mb-1">{error.message}</p>
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed mt-2">
{error.stack}
              </pre>
              {componentStack ? (
                <>
                  <p className="font-medium text-sm mt-3 mb-1">Component stack</p>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
{componentStack}
                  </pre>
                </>
              ) : null}
            </div>
          </details>

          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={this.copyStack}
              className="px-4 py-2 text-sm rounded-md border border-border bg-card text-foreground cursor-pointer hover:bg-accent transition-colors"
            >
              Copy error
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground cursor-pointer hover:opacity-90 transition-opacity"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export function SentryErrorBoundary({ children }: { children: ReactNode }) {
  // Sentry's boundary still reports remotely (when DSN is set). The local
  // boundary nests inside so we always get the in-app fallback even if Sentry
  // isn't configured.
  return (
    <Sentry.ErrorBoundary fallback={({ error, componentStack, resetError }) => (
      <LocalErrorBoundary>
        {/* Force the local boundary to re-render with the captured error */}
        <ThrowOnMount error={error as Error} stack={componentStack} resetError={resetError} />
      </LocalErrorBoundary>
    )}>
      <LocalErrorBoundary>{children}</LocalErrorBoundary>
    </Sentry.ErrorBoundary>
  );
}

/**
 * Helper that re-throws an error inside a child boundary so the local fallback
 * can display it. Used when Sentry's outer boundary catches first but we still
 * want our richer UI.
 */
function ThrowOnMount({ error }: { error: Error; stack?: string | null; resetError?: () => void }): null {
  throw error;
}
