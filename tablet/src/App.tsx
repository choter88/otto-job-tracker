import { useState, useCallback, useEffect } from "react";
import { setAuthToken, setOnAuthExpired, fetchConfig, fetchJobs, fetchOfficeInfo, logout } from "./api";
import { usePoller } from "./usePoller";
import type { ViewState, TabletUser, OfficeConfig, Job, NotificationRule } from "./types";
import { LoginView } from "./views/LoginView";
import { BoardView } from "./views/BoardView";
import { JobDetailView } from "./views/JobDetailView";
import { NewJobView } from "./views/NewJobView";
import { ConnectionBanner } from "./components/ConnectionBanner";

export function App() {
  const [viewState, setViewState] = useState<ViewState>({ view: "login", step: "userSelect" });
  const [user, setUser] = useState<TabletUser | null>(null);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [config, setConfig] = useState<OfficeConfig | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([]);
  const [boardTab, setBoardTab] = useState<string>("");
  const [boardPage, setBoardPage] = useState(0);

  // Check if tablet is enabled on startup
  useEffect(() => {
    fetchOfficeInfo()
      .then((info) => {
        if (!info.tabletEnabled) {
          setViewState({ view: "disabled" });
        }
      })
      .catch(() => {
        // Will retry via poller
      });
  }, []);

  // Handle auth expiry
  useEffect(() => {
    setOnAuthExpired(() => {
      setUser(null);
      setViewState({ view: "login", step: "userSelect" });
    });
  }, []);

  const loadData = useCallback(async () => {
    if (!officeId) return;
    try {
      const [configData, jobsData] = await Promise.all([fetchConfig(), fetchJobs()]);
      setConfig(configData as OfficeConfig);
      setJobs(jobsData.jobs);
      setCommentCounts(jobsData.commentCounts);
      setNotificationRules(jobsData.notificationRules);

      // Default to first non-cancelled status tab
      if (!boardTab && configData.customStatuses?.length > 0) {
        const first = configData.customStatuses
          .filter((s: any) => s.id !== "cancelled" && s.id !== "completed")
          .sort((a: any, b: any) => a.order - b.order)[0];
        if (first) setBoardTab(first.id);
      }
    } catch {
      // Connection banner handles errors
    }
  }, [officeId, boardTab]);

  const pollerState = usePoller(loadData, viewState.view !== "login" && viewState.view !== "disabled");

  const handleLogin = useCallback(
    (token: string, loginUser: TabletUser, loginOfficeId: string) => {
      setAuthToken(token);
      setUser(loginUser);
      setOfficeId(loginOfficeId);
      setViewState({ view: "board" });
      // Data will load via poller
    },
    [],
  );

  const handleLogout = useCallback(() => {
    logout().catch(() => {});
    setAuthToken(null);
    setUser(null);
    setOfficeId(null);
    setConfig(null);
    setJobs([]);
    setCommentCounts({});
    setBoardTab("");
    setBoardPage(0);
    setViewState({ view: "login", step: "userSelect" });
  }, []);

  const navigateTo = useCallback((state: ViewState) => {
    setViewState(state);
  }, []);

  if (viewState.view === "disabled") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 32, textAlign: "center" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Tablet Access Not Enabled</h2>
          <p style={{ color: "var(--otto-text-muted)", fontSize: "0.9375rem" }}>
            Contact your office administrator to enable tablet access.
          </p>
        </div>
      </div>
    );
  }

  if (viewState.view === "login") {
    return <LoginView viewState={viewState} onLogin={handleLogin} navigateTo={navigateTo} />;
  }

  return (
    <>
      <ConnectionBanner connected={pollerState.connected} stale={pollerState.stale} />
      {viewState.view === "board" && config && (
        <BoardView
          user={user!}
          config={config}
          jobs={jobs}
          commentCounts={commentCounts}
          notificationRules={notificationRules}
          activeTab={boardTab}
          page={boardPage}
          onTabChange={(tab) => { setBoardTab(tab); setBoardPage(0); }}
          onPageChange={setBoardPage}
          onJobSelect={(id) => navigateTo({ view: "jobDetail", jobId: id })}
          onNewJob={() => navigateTo({ view: "newJob" })}
          onLogout={handleLogout}
          onDataChanged={loadData}
        />
      )}
      {viewState.view === "jobDetail" && config && (
        <JobDetailView
          jobId={viewState.jobId}
          config={config}
          onBack={() => navigateTo({ view: "board" })}
          onDataChanged={loadData}
        />
      )}
      {viewState.view === "newJob" && config && (
        <NewJobView
          config={config}
          onBack={() => navigateTo({ view: "board" })}
          onCreated={() => { loadData(); navigateTo({ view: "board" }); }}
        />
      )}
    </>
  );
}
