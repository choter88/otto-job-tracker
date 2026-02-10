import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Glasses, 
  Briefcase, 
  Archive, 
  AlertTriangle, 
  BarChart3, 
  Users, 
  LogOut,
  Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job, Office } from "@shared/schema";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { user, logoutMutation } = useAuth();

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    enabled: !!user?.officeId,
  });

  const { data: overdueJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/overdue"],
    enabled: !!user?.officeId,
  });

  const { data: flaggedJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/flagged"],
    enabled: !!user?.officeId,
  });

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const activeJobsCount = jobs.length;
  const overdueCount = overdueJobs.length;
  const flaggedCount = flaggedJobs.length;

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const menuItems = [
    {
      id: "all",
      label: "Worklist",
      icon: Briefcase,
      badge: activeJobsCount > 0 ? activeJobsCount : null,
    },
    {
      id: "important",
      label: "Important",
      icon: Star,
      badge: flaggedCount > 0 ? flaggedCount : null,
    },
    {
      id: "past",
      label: "Past Jobs",
      icon: Archive,
      badge: null,
    },
    {
      id: "overdue",
      label: "Overdue",
      icon: AlertTriangle,
      badge: overdueCount > 0 ? overdueCount : null,
      variant: overdueCount > 0 ? "destructive" : "default",
    },
    {
      id: "analytics",
      label: "Analytics",
      icon: BarChart3,
      badge: null,
    },
  ];

  const bottomMenuItems = [
    {
      id: "team",
      label: "Team",
      icon: Users,
    },
  ];

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col pb-16" data-testid="sidebar">
      {/* Office Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <Glasses className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-foreground truncate" data-testid="text-office-name">
              {office?.name || "Loading..."}
            </h2>
            <p className="text-xs text-muted-foreground capitalize" data-testid="text-user-role">
              {user?.role || "Staff"}
            </p>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id || (item.id === "all" && activeTab === "all");
          
          return (
            <Button
              key={`${item.id}-${item.label}`}
              variant="ghost"
              className={cn(
                "w-full justify-start gap-3 h-10",
                isActive && "bg-accent text-accent-foreground"
              )}
              onClick={() => onTabChange(item.id)}
              data-testid={`nav-${item.id}`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge !== null && (
                <Badge 
                  variant={(item as any).variant || "secondary"} 
                  className="text-xs"
                  data-testid={`badge-${item.id}`}
                >
                  {item.badge}
                </Badge>
              )}
            </Button>
          );
        })}

        {/* Divider */}
        <div className="pt-4 border-t border-border mt-4">
          {bottomMenuItems.map((item) => {
            const Icon = item.icon;
            
            return (
              <Button
                key={item.id}
                variant="ghost"
                className="w-full justify-start gap-3 h-10"
                onClick={() => onTabChange(item.id)}
                data-testid={`nav-${item.id}`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Button>
            );
          })}
        </div>
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer group">
          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-primary font-semibold text-sm">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
              {user?.email}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
