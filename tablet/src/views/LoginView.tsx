import { useState, useEffect, useCallback } from "react";
import { fetchOfficeInfo, fetchUsers, login } from "../api";
import { PinKeypad } from "../components/PinKeypad";
import type { ViewState, LoginUser, TabletUser } from "../types";
import "../styles/login.css";

interface LoginViewProps {
  viewState: Extract<ViewState, { view: "login" }>;
  onLogin: (token: string, user: TabletUser, officeId: string) => void;
  navigateTo: (state: ViewState) => void;
}

export function LoginView({ viewState, onLogin, navigateTo }: LoginViewProps) {
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [officeName, setOfficeName] = useState("");
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchOfficeInfo()
      .then((info) => {
        setOfficeId(info.officeId);
        setOfficeName(info.officeName);
        return fetchUsers(info.officeId);
      })
      .then(setUsers)
      .catch(() => setError("Unable to connect to server"));
  }, []);

  const handleDigit = useCallback(
    (digit: string) => {
      if (viewState.step !== "pinEntry" || loading) return;
      const newPin = pin + digit;
      if (newPin.length > 6) return;
      setPin(newPin);
      setError("");

      // Auto-submit on 6th digit
      if (newPin.length === 6) {
        setLoading(true);
        login(viewState.user.id, newPin)
          .then((result) => {
            onLogin(result.token, result.user as TabletUser, result.officeId!);
          })
          .catch(() => {
            setError("Incorrect PIN");
            setShaking(true);
            setPin("");
            setLoading(false);
            setTimeout(() => setShaking(false), 500);
          });
      }
    },
    [pin, viewState, loading, onLogin],
  );

  const handleBackspace = useCallback(() => {
    if (loading) return;
    setPin((p) => p.slice(0, -1));
    setError("");
  }, [loading]);

  if (viewState.step === "pinEntry") {
    const { user } = viewState;
    return (
      <div className="login-container">
        <div className="pin-container">
          <button
            className="pin-back-btn"
            onClick={() => { setPin(""); setError(""); navigateTo({ view: "login", step: "userSelect" }); }}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
            Back
          </button>
          <div className="pin-user-name">{user.firstName} {user.lastName}</div>
          <div className="pin-dots">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`pin-dot ${i < pin.length ? "filled" : ""}`} />
            ))}
          </div>
          <div className={`pin-error ${shaking ? "shake" : ""}`}>{error}</div>
          <PinKeypad onDigit={handleDigit} onBackspace={handleBackspace} />
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" className="login-logo">
        <rect width="64" height="64" rx="16" fill="hsl(230, 70%, 56%)" />
        <text x="32" y="44" textAnchor="middle" fill="white" fontSize="32" fontWeight="700" fontFamily="system-ui">O</text>
      </svg>
      <h1 className="login-title">{officeName || "Otto Lab Board"}</h1>
      <p className="login-subtitle">Select your name to sign in</p>
      {error && <p className="pin-error">{error}</p>}
      <div className="user-grid">
        {users.map((u) => (
          <button
            key={u.id}
            className="user-card"
            onClick={() => navigateTo({ view: "login", step: "pinEntry", user: u })}
            type="button"
          >
            {u.firstName} {u.lastName}
          </button>
        ))}
      </div>
      {users.length === 0 && !error && (
        <p style={{ color: "var(--otto-text-muted)", marginTop: 24 }}>Loading users...</p>
      )}
    </div>
  );
}
