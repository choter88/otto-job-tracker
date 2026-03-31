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
  PanelLeft,
  ChevronRight,
  MessageCircleQuestion,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Job, Office } from "@shared/schema";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onFeedbackClick?: () => void;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "otto.sidebar.collapsed";

export default function Sidebar({ activeTab, onTabChange, onFeedbackClick }: SidebarProps) {
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

  // Fixed icon column width (matches w-20 = 80px).
  // When expanded, a text column slides out to the right; icons never move.
  const ICON_COL = "w-20"; // 80px — always present
  const EXPANDED_W = "w-64"; // 256px total when expanded

  return (
    <aside
      className={cn(
        "bg-card border-r border-border flex flex-col pb-3 transition-[width] duration-200 overflow-hidden",
        collapsed ? ICON_COL : EXPANDED_W,
      )}
      data-testid="sidebar"
    >
      {/* Office Header */}
      <div className="border-b border-border">
        {/* Logo row — icon + office info + collapse toggle */}
        <div className="flex items-center h-14">
          <span
            className={cn("flex items-center justify-center shrink-0", ICON_COL, collapsed && "cursor-pointer")}
            onClick={collapsed ? () => setCollapsed(false) : undefined}
            title={collapsed ? "Expand sidebar" : undefined}
          >
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Glasses className="h-5 w-5 text-primary-foreground" />
            </div>
          </span>
          {!collapsed && (
            <div className="flex-1 min-w-0 flex items-center gap-2 pr-2">
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-foreground truncate" data-testid="text-office-name">
                  {office?.name || "Loading..."}
                </h2>
                <p className="text-xs text-muted-foreground capitalize" data-testid="text-user-role">
                  {user?.role || "Staff"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setCollapsed((prev) => !prev)}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                data-testid="button-toggle-sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 py-4 space-y-0.5 px-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id || (item.id === "all" && activeTab === "all");

          return (
            <button
              key={`${item.id}-${item.label}`}
              type="button"
              className={cn(
                "w-full flex items-center h-10 text-sm font-medium rounded-md",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive && "bg-accent text-accent-foreground border-l-[3px] border-l-primary",
                !isActive && "text-muted-foreground border-l-[3px] border-l-transparent",
              )}
              onClick={() => onTabChange(item.id)}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              data-testid={`nav-${item.id}`}
            >
              {/* Fixed-width icon area — never moves */}
              <span className={cn("flex items-center justify-center shrink-0 relative", collapsed ? "w-full" : "w-16")}>
                <Icon className="h-4 w-4" />
                {item.badge !== null && collapsed && (
                  <Badge
                    variant={(item as any).variant || "secondary"}
                    className="absolute -top-0.5 right-1 h-4 min-w-4 px-1 text-[10px] leading-none flex items-center justify-center z-10"
                    data-testid={`badge-${item.id}`}
                  >
                    {item.badge}
                  </Badge>
                )}
              </span>
              {/* Text + badge area — only visible when expanded */}
              {!collapsed && (
                <span className="flex items-center justify-between flex-1 pr-3">
                  <span>{item.label}</span>
                  {item.badge !== null && (
                    <Badge
                      variant={(item as any).variant || "secondary"}
                      className="text-xs"
                      data-testid={`badge-${item.id}`}
                    >
                      {item.badge}
                    </Badge>
                  )}
                </span>
              )}
            </button>
          );
        })}

        {/* Divider */}
        <div className="pt-4 mt-4 border-t border-border">
          {bottomMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "w-full flex items-center h-10 text-sm font-medium rounded-md",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && "bg-accent text-accent-foreground border-l-[3px] border-l-primary",
                  !isActive && "text-muted-foreground border-l-[3px] border-l-transparent",
                )}
                onClick={() => onTabChange(item.id)}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                data-testid={`nav-${item.id}`}
              >
                <span className={cn("flex items-center justify-center shrink-0", collapsed ? "w-full" : "w-16")}>
                  <Icon className="h-4 w-4" />
                </span>
                {!collapsed && (
                  <span className="flex-1 text-left">{item.label}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Expand button — only visible when collapsed */}
      {collapsed && (
        <div className="px-2 pb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-center h-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md transition-colors"
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              <p>Expand sidebar</p>
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Help & Feedback — pinned to bottom */}
      <div className="border-t border-border py-3 px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "w-full flex items-center h-10 text-sm font-medium rounded-md",
                "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              onClick={onFeedbackClick}
              aria-label="Help & Feedback"
              data-testid="nav-feedback"
            >
              <span className={cn("flex items-center justify-center shrink-0", collapsed ? "w-full" : "w-16")}>
                <MessageCircleQuestion className="h-4 w-4" />
              </span>
              {!collapsed && (
                <span className="flex-1 text-left">Help & Feedback</span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" align="center">
            <p>Request a feature, report a bug, or ask a question</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
