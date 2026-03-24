import * as Sentry from "@sentry/react";
import type { ReactNode } from "react";

function ErrorFallback() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        padding: "2rem",
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
        Something went wrong
      </h1>
      <p style={{ color: "#666", marginBottom: "1.5rem", maxWidth: "400px" }}>
        An unexpected error occurred. Please restart the app. If the problem
        persists, contact support.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "0.5rem 1.5rem",
          fontSize: "1rem",
          borderRadius: "6px",
          border: "1px solid #ccc",
          background: "#fff",
          cursor: "pointer",
        }}
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
