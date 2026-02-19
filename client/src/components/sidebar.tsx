import { useEffect, useState } from "react";
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
  Star,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job, Office } from "@shared/schema";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "otto.sidebar.collapsed";

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  }, [collapsed]);

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
    <aside
      className={cn(
        "bg-card border-r border-border flex flex-col pb-16 transition-[width] duration-200",
        collapsed ? "w-20" : "w-64",
      )}
      data-testid="sidebar"
    >
      {/* Office Header */}
      <div className={cn("border-b border-border", collapsed ? "p-3" : "p-6")}>
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center shrink-0">
            <Glasses className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-foreground truncate" data-testid="text-office-name">
                {office?.name || "Loading..."}
              </h2>
              <p className="text-xs text-muted-foreground capitalize" data-testid="text-user-role">
                {user?.role || "Staff"}
              </p>
            </div>
          )}
        </div>
        <div className={cn("mt-3", collapsed ? "flex justify-center" : "flex justify-end")}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCollapsed((prev) => !prev)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-testid="button-toggle-sidebar"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
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
                "w-full gap-3 h-10 relative",
                collapsed ? "justify-center px-2" : "justify-start",
                isActive && "bg-accent text-accent-foreground"
              )}
              onClick={() => onTabChange(item.id)}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              data-testid={`nav-${item.id}`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
              {item.badge !== null && (
                <Badge 
                  variant={(item as any).variant || "secondary"} 
                  className={cn(
                    "text-xs",
                    collapsed
                      ? "absolute top-1 right-1 h-5 min-w-5 px-1 flex items-center justify-center"
                      : "",
                  )}
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
                className={cn("w-full gap-3 h-10", collapsed ? "justify-center px-2" : "justify-start")}
                onClick={() => onTabChange(item.id)}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                data-testid={`nav-${item.id}`}
              >
                <Icon className="h-4 w-4" />
                {!collapsed && <span>{item.label}</span>}
              </Button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
