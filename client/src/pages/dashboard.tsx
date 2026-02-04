import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation, useRoute } from "wouter";
import Sidebar from "@/components/sidebar";
import JobsTable from "@/components/jobs-table";
import PastJobs from "@/components/past-jobs";
import OverdueJobs from "@/components/overdue-jobs";
import TeamPage from "@/components/team-page";
import NotificationRules from "@/components/notification-rules";
import AnalyticsDashboard from "@/components/analytics-dashboard";
import ImportantJobs from "@/pages/important-jobs";
import NotificationBell from "@/components/notification-bell";
import SettingsModal from "@/components/settings-modal";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Settings } from "lucide-react";
import type { Job, ArchivedJob, Office } from "@shared/schema";

export default function Dashboard() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Derive tab from URL - check if we're on a specific tab route
  const [, importantParams] = useRoute("/important");
  const [, dashboardParams] = useRoute("/dashboard/:tab?");
  
  // Determine initial tab from URL or default to "important"
  const getInitialTab = () => {
    if (importantParams) return "important";
    if (dashboardParams && dashboardParams.tab) return dashboardParams.tab;
    return "important";
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);

  // Sync activeTab with URL changes and redirect /important to /
  useEffect(() => {
    // Redirect /important to / for canonical URL
    if (location === "/important") {
      setLocation("/");
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
    if (tab === "important") {
      setLocation("/");
    } else {
      setLocation(`/dashboard/${tab}`);
    }
  };

  // Redirect to office setup if no office
  if (user && !user.officeId) {
    return <Redirect to="/office-setup" />;
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
        return <ImportantJobs />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-dashboard-title">
              {activeTab === "important" && "Important Jobs"}
              {activeTab === "all" && "All Jobs"}
              {activeTab === "past" && "Past Jobs"}
              {activeTab === "overdue" && "Overdue Jobs"}
              {activeTab === "analytics" && "Analytics"}
              {activeTab === "team" && "Team"}
              {activeTab === "settings" && "Settings"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeTab === "important" && "Jobs flagged by you or your team with AI summaries"}
              {activeTab === "all" && "Manage your jobs and orders"}
              {activeTab === "past" && "View archived completed and cancelled jobs"}
              {activeTab === "overdue" && "Jobs that need immediate attention"}
              {activeTab === "analytics" && "Track performance and insights"}
              {activeTab === "team" && "Manage office members and join requests"}
              {activeTab === "settings" && "Configure notification rules and preferences"}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Notifications */}
            <NotificationBell />

            {/* Settings */}
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setSettingsOpen(true)}
              data-testid="button-open-settings"
            >
              <Settings className="h-5 w-5" />
            </Button>

            {/* User Menu */}
            <Button variant="ghost" className="flex items-center gap-2" data-testid="button-user-menu">
              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-primary font-semibold text-sm">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Tab Content */}
          {renderTabContent()}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
