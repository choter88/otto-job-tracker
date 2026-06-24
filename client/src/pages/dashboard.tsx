import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useRoute } from "wouter";
import Sidebar from "@/components/sidebar";
import Topbar from "@/components/topbar";
import JobsTable from "@/components/jobs-table";
import PastJobs from "@/components/past-jobs";
import OverdueJobs from "@/components/overdue-jobs";
import TeamPage from "@/components/team-page";
import NotificationRules from "@/components/notification-rules";
import AnalyticsDashboard from "@/components/analytics-dashboard";
import ImportantJobs from "@/pages/important-jobs";
import OrderSheetsPage from "@/components/order-sheets-page";
import Today from "@/pages/today";
import SettingsModal from "@/components/settings-modal";
import HealthModal from "@/components/health-modal";
import UserSettingsModal, { applyUserPreferences } from "@/components/user-settings-modal";
import { FeedbackDialog } from "@/components/feedback-dialog";
import BackupRestoreBanner from "@/components/backup-restore-banner";
import { OPEN_OFFICE_SETTINGS_EVENT } from "@/components/spotlight/feature-spotlight-host";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useOrderSheetIngestion } from "@/hooks/use-order-sheets";
import type { Job, Office } from "@shared/schema";

export default function Dashboard() {
  const { user, logoutMutation } = useAuth();

  // App-wide order-sheet worker: ships files discovered by the desktop
  // watcher to the server no matter which tab is open. No-op outside
  // Electron. Mounted here (not App) so it only runs for signed-in,
  // office-attached users.
  useOrderSheetIngestion();
  const [location, setLocation] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const [healthOpen, setHealthOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);

  // Listen for the global "open office settings" event fired by the
  // spotlight system (and potentially other deep-link sources later).
  // Translates an event with `{ tab }` into opening the SettingsModal
  // pre-selected to that tab.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const tab = typeof detail?.tab === "string" ? detail.tab : undefined;
      setSettingsInitialTab(tab);
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_OFFICE_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_OFFICE_SETTINGS_EVENT, handler);
  }, []);

  // Derive tab from URL - check if we're on a specific tab route
  const [, importantParams] = useRoute("/important");
  const [, dashboardParams] = useRoute("/dashboard/:tab?");
  
  // Determine initial tab from URL or default to Today (unless user prefers Worklist)
  const getInitialTab = () => {
    if (importantParams) return "important";
    if (dashboardParams && dashboardParams.tab) return dashboardParams.tab;
    // No explicit tab in the URL → honor the user's saved default view.
    // Default is Today (the redesign's home); only an explicit "worklist" opts out.
    const dv = (user?.preferences as any)?.defaultView;
    return dv === "worklist" ? "all" : "today";
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);

  // Apply user preferences (font size, dark mode) on load
  useEffect(() => {
    if (user?.preferences) {
      applyUserPreferences(user.preferences);
    }
  }, [user?.id]);

  // Sync activeTab with URL changes and redirect /important to canonical route
  useEffect(() => {
    // Redirect legacy /important route to canonical URL
    if (location === "/important") {
      setLocation("/dashboard/important");
      return;
    }
    
    const newTab = getInitialTab();
    if (newTab !== activeTab) {
      setActiveTab(newTab);
    }
  }, [location, user?.id]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    // Every tab gets an explicit /dashboard/<tab> URL. "/" is reserved for the
    // user's default view; mapping Worklist to "/" too made the URL-sync effect
    // re-resolve "/" → default view (now Today) and bounce the first click back.
    setLocation(`/dashboard/${tab}`);
  };

  // Fetch jobs data. These hooks must run unconditionally — before any early
  // return — so the hook order is stable across renders (rules-of-hooks /
  // React #310). They no-op without an office via `enabled`.
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    enabled: !!user?.officeId,
  });

  const { data: overdueJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/overdue"],
    enabled: !!user?.officeId,
  });

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  // A user without an office can't use the desktop app. This can happen if they were removed by the owner.
  // (Early return lives AFTER the hooks above so hook order stays stable.)
  if (user && !user.officeId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-background">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>No office access</CardTitle>
            <p className="text-sm text-muted-foreground">
              This login isn’t connected to an office on this Host. Ask your office owner to add you again.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "important":
        return <ImportantJobs />;
      case "all":
        return <JobsTable jobs={jobs} loading={jobsLoading} />;
      case "past":
        return <PastJobs />;
      case "orderSheets":
        return <OrderSheetsPage />;
      case "overdue":
        return <OverdueJobs jobs={overdueJobs} />;
      case "analytics":
        return <AnalyticsDashboard />;
      case "team":
        return <TeamPage />;
      case "settings":
        return <NotificationRules />;
      case "today":
        return <Today />;
      default:
        return <JobsTable jobs={jobs} loading={jobsLoading} />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium">
        Skip to main content
      </a>
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onSettingsClick={() => setSettingsOpen(true)}
        onHealthClick={() => setHealthOpen(true)}
        onFeedbackClick={() => setFeedbackOpen(true)}
        onUserSettingsClick={() => setUserSettingsOpen(true)}
      />

      <main id="main-content" className="flex-1 flex flex-col overflow-hidden bg-panel border border-line rounded-[14px] m-3.5 ml-1 shadow-soft">
        <Topbar activeTab={activeTab} onHelpClick={() => setFeedbackOpen(true)} />

        {/* Content — faint accent-tinted canvas so white content tiles read as raised. */}
        <div className={`flex-1 overflow-y-auto bg-[var(--page-bg)] ${activeTab === "all" ? "" : "p-6 pb-8"}`}>
          <div className={activeTab === "all" ? "px-6 pt-4" : ""}>
            <BackupRestoreBanner />
          </div>
          {/* Tab Content */}
          {renderTabContent()}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onOpenChange={(o) => {
          setSettingsOpen(o);
          // Clear the initialTab when the modal closes so the next
          // "Settings" click from the user menu lands on General again.
          if (!o) setSettingsInitialTab(undefined);
        }}
        initialTab={settingsInitialTab}
      />
      <HealthModal open={healthOpen} onOpenChange={setHealthOpen} />
      <UserSettingsModal open={userSettingsOpen} onOpenChange={setUserSettingsOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
