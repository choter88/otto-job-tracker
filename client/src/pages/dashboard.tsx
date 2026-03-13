import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useRoute } from "wouter";
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
import HealthModal from "@/components/health-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, LogOut, Settings } from "lucide-react";
import type { Job, ArchivedJob, Office } from "@shared/schema";

export default function Dashboard() {
  const { user, logoutMutation } = useAuth();
  const [location, setLocation] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);

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
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-dashboard-title">
              {activeTab === "important" && "Important Jobs"}
              {activeTab === "all" && "Worklist"}
              {activeTab === "past" && "Past Jobs"}
              {activeTab === "overdue" && "Overdue Jobs"}
              {activeTab === "analytics" && "Analytics"}
              {activeTab === "team" && "Team"}
              {activeTab === "settings" && "Settings"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeTab === "important" && "Jobs starred by you or your team for extra attention"}
              {activeTab === "all" && "Active jobs your team is working on"}
              {activeTab === "past" && "View archived completed and cancelled jobs"}
              {activeTab === "overdue" && "Jobs that need immediate attention"}
              {activeTab === "analytics" && "Track performance and insights"}
              {activeTab === "team" && "Manage office members and pending account requests"}
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2" data-testid="button-user-menu">
                  <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-primary font-semibold text-sm">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </div>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60" data-testid="menu-user">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground truncate">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setHealthOpen(true)} data-testid="menu-user-health">
                  <Activity className="h-4 w-4" />
                  System Health
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)} data-testid="menu-user-settings">
                  <Settings className="h-4 w-4" />
                  Office Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => logoutMutation.mutate()} data-testid="menu-user-signout">
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 pb-16">
          {/* Tab Content */}
          {renderTabContent()}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <HealthModal open={healthOpen} onOpenChange={setHealthOpen} />
    </div>
  );
}
