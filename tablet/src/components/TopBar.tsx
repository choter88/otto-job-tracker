import "../styles/top-bar.css";
import type { TabletUser } from "../types";

interface TopBarProps {
  user: TabletUser;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onNewJob: () => void;
  onLogout: () => void;
}

export function TopBar({ user, searchQuery, onSearchChange, onNewJob, onLogout }: TopBarProps) {
  return (
    <div className="top-bar">
      <svg className="top-bar-logo" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="hsl(230, 70%, 56%)" />
        <text x="16" y="22" textAnchor="middle" fill="white" fontSize="16" fontWeight="700" fontFamily="system-ui">O</text>
      </svg>
      <span className="top-bar-title">Lab Board</span>
      <input
        className="top-bar-search"
        type="text"
        placeholder="Search patients..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <div className="top-bar-spacer" />
      <span className="top-bar-user">{user.firstName} {user.lastName}</span>
      <button className="top-bar-btn primary" onClick={onNewJob} type="button">+ New</button>
      <button className="top-bar-btn ghost" onClick={onLogout} type="button">Sign Out</button>
    </div>
  );
}
