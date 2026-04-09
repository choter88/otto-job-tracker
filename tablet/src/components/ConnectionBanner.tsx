import { useState, useEffect, useRef } from "react";

interface ConnectionBannerProps {
  connected: boolean;
  stale: boolean;
}

export function ConnectionBanner({ connected, stale }: ConnectionBannerProps) {
  const [showReconnected, setShowReconnected] = useState(false);
  const wasDisconnected = useRef(false);

  useEffect(() => {
    if (!connected) {
      wasDisconnected.current = true;
      setShowReconnected(false);
    } else if (wasDisconnected.current) {
      wasDisconnected.current = false;
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [connected]);

  if (!connected) {
    return (
      <div style={{
        padding: "8px 16px",
        background: "hsl(38, 92%, 50%)",
        color: "white",
        fontSize: "0.8125rem",
        fontWeight: 500,
        textAlign: "center",
        flexShrink: 0,
      }}>
        Connection lost — retrying...
      </div>
    );
  }

  if (stale) {
    return (
      <div style={{
        padding: "6px 16px",
        background: "hsl(220, 13%, 91%)",
        color: "hsl(215, 16%, 47%)",
        fontSize: "0.75rem",
        textAlign: "center",
        flexShrink: 0,
      }}>
        Data may be stale
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div style={{
        padding: "6px 16px",
        background: "hsl(142, 71%, 45%)",
        color: "white",
        fontSize: "0.75rem",
        fontWeight: 500,
        textAlign: "center",
        flexShrink: 0,
      }}>
        Reconnected
      </div>
    );
  }

  return null;
}
