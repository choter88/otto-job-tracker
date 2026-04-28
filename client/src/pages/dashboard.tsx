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
import SettingsModal from "@/components/settings-modal";
import HealthModal from "@/components/health-modal";
import UserSettingsModal, { applyUserPreferences } from "@/components/user-settings-modal";
import { FeedbackDialog } from "@/components/feedback-dialog";
import BackupRestoreBanner from "@/components/backup-restore-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import type { Job, Office } from "@shared/schema";

export default function Dashboard() {
  const { user, logoutMutation } = useAuth();
  const [location, setLocation] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);

  // Derive tab from URL - check if we're on a specific tab route
  const [, importantParams] = useRoute("/important");
  const [, dashboardParams] = useRoute("/dashboard/:tab?");
  
  // Determine initial tab from URL or default to Worklist
  const getInitialTab = () => {
    if (importantParams) return "important";
    if (dashboardParams && dashboardParams.tab) return dashboardParams.tab;
    return "all";
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
  }, [location]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    // Update URL to reflect tab change
    if (tab === "all") {
      setLocation("/");
    } else {
      setLocation(`/dashboard/${tab}`);
    }
  };

  // A user without an office can't use the desktop app. This can happen if they were removed by the owner.
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

  // Fetch jobs data
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

  const renderTabContent = () => {
    switch (activeTab) {
      case "important":
        return <ImportantJobs />;
      case "all":
        return <JobsTable jobs={jobs} loading={jobsLoading} />;
      case "past":
        return <PastJobs />;
      case "overdue":
        return <OverdueJobs jobs={overdueJobs} />;
      case "analytics":
        return <AnalyticsDashboard />;
      case "team":
        return <TeamPage />;
      case "settings":
        return <NotificationRules />;
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

        {/* Content */}
        <div className={`flex-1 overflow-y-auto ${activeTab === "all" ? "" : "p-6 pb-8"}`}>
          <div className={activeTab === "all" ? "px-6 pt-4" : ""}>
            <BackupRestoreBanner />
          </div>
          {/* Tab Content */}
          {renderTabContent()}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <HealthModal open={healthOpen} onOpenChange={setHealthOpen} />
      <UserSettingsModal open={userSettingsOpen} onOpenChange={setUserSettingsOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
