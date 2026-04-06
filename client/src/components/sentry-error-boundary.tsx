import * as Sentry from "@sentry/react";
import type { ReactNode } from "react";

function ErrorFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-screen p-8 text-center font-sans bg-background text-foreground">
      <h1 className="text-2xl font-semibold mb-4">
        Something went wrong
      </h1>
      <p className="text-muted-foreground mb-6 max-w-[400px]">
        An unexpected error occurred. Please restart the app. If the problem
        persists, contact support.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-2 text-base rounded-md border border-border bg-card text-foreground cursor-pointer hover:bg-accent transition-colors"
      >
        Reload
      </button>
    </div>
  );
}

export function SentryErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
