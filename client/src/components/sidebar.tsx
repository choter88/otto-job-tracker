import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Briefcase,
  Archive,
  AlertTriangle,
  BarChart3,
  Users,
  Star,
  Settings,
  Activity,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  MoreVertical,
  MessageCircleQuestion,
  HelpCircle,
} from "lucide-react";
import logoSymbol from "@/assets/logo-symbol.png";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Job, Office } from "@shared/schema";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onSettingsClick?: () => void;
  onHealthClick?: () => void;
  onFeedbackClick?: () => void;
  onUserSettingsClick?: () => void;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "otto.sidebar.collapsed";

type NavItem = {
  id: string;
  label: string;
  icon: typeof Briefcase;
  badge?: number | null;
  badgeStyle?: "default" | "alert" | "warn";
  onClickOverride?: () => void;
};

export default function Sidebar({
  activeTab,
  onTabChange,
  onSettingsClick,
  onHealthClick,
  onFeedbackClick,
  onUserSettingsClick,
}: SidebarProps) {
  const { user, logoutMutation } = useAuth();

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
      // ignore
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

  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase() || "??";
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "User";

  const jobsItems: NavItem[] = [
    {
      id: "all",
      label: "Worklist",
      icon: Briefcase,
      badge: jobs.length || null,
    },
    {
      id: "important",
      label: "Starred",
      icon: Star,
      badge: flaggedJobs.length || null,
      badgeStyle: "warn",
    },
    {
      id: "overdue",
      label: "Overdue",
      icon: AlertTriangle,
      badge: overdueJobs.length || null,
      badgeStyle: "alert",
    },
    {
      id: "past",
      label: "Past Jobs",
      icon: Archive,
    },
  ];

  const officeItems: NavItem[] = [
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "team", label: "Team", icon: Users },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      onClickOverride: onSettingsClick,
    },
  ];

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = !item.onClickOverride && activeTab === item.id;
    const handleClick = () => {
      if (item.onClickOverride) item.onClickOverride();
      else onTabChange(item.id);
    };

    const badgeClass =
      item.badgeStyle === "alert"
        ? "bg-danger-bg text-danger"
        : item.badgeStyle === "warn"
          ? "bg-warn-bg text-warn"
          : "text-ink-mute";

    return (
      <Tooltip key={item.id}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            className={cn(
              "w-full h-8 px-3 rounded-lg flex items-center gap-[11px] text-[calc(13px*var(--ui-scale))] font-medium",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-panel text-ink shadow-[0_0_0_1px_var(--line),0_1px_1px_rgba(28,38,60,0.03)]"
                : "text-ink-2 hover:bg-line-2 hover:text-ink",
              collapsed && "justify-center px-0",
            )}
            data-testid={`nav-${item.id}`}
            aria-label={item.label}
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isActive ? "text-otto-accent" : "text-ink-mute group-hover:text-ink-2",
              )}
            />
            {!collapsed && (
              <>
                <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span
                    className={cn(
                      "font-mono text-[calc(10.5px*var(--ui-scale))] font-medium px-1.5 rounded-full leading-[18px] tabular-nums",
                      badgeClass,
                    )}
                    data-testid={`badge-${item.id}`}
                  >
                    {item.badge}
                  </span>
                )}
              </>
            )}
          </button>
        </TooltipTrigger>
        {collapsed && (
          <TooltipContent side="right" align="center">
            {item.label}
            {item.badge != null && item.badge > 0 ? ` · ${item.badge}` : ""}
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

  return (
    <aside
      className={cn(
        "flex flex-col gap-1 px-2.5 py-3.5 transition-[width] duration-200 overflow-hidden",
        collapsed ? "w-14" : "w-56",
      )}
      data-testid="sidebar"
    >
      {/* Brand block */}
      <div className="flex items-center gap-1.5 pb-2 px-1 min-h-10">
        <button
          type="button"
          onClick={() => collapsed && setCollapsed(false)}
          className={cn(
            "flex items-center gap-2.5 flex-1 min-w-0 -mx-1 px-1 py-1 rounded-md",
            collapsed ? "cursor-pointer hover:bg-line-2" : "cursor-default",
          )}
          aria-label={collapsed ? "Expand sidebar" : undefined}
        >
          <div className="w-8 h-8 rounded-md bg-paper-2 grid place-items-center shrink-0 overflow-hidden">
            <img src={logoSymbol} alt="Otto" className="w-6 h-6 object-contain" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div
                className="font-display font-semibold text-[calc(14.5px*var(--ui-scale))] leading-tight text-ink truncate"
                data-testid="text-office-name"
              >
                {office?.name || "Otto"}
              </div>
              <div className="font-mono text-[calc(10.5px*var(--ui-scale))] text-ink-mute lowercase mt-0.5">
                otto host
              </div>
            </div>
          )}
        </button>

        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="w-7 h-7 rounded-md grid place-items-center text-ink-mute hover:bg-line-2 hover:text-ink shrink-0"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            data-testid="button-toggle-sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto -mx-0.5 px-0.5 flex flex-col gap-0.5">
        {/* Jobs section */}
        {!collapsed && (
          <div className="text-[calc(10px*var(--ui-scale))] uppercase tracking-[0.12em] text-ink-mute font-semibold px-3 pt-4 pb-1.5">
            Jobs
          </div>
        )}
        {collapsed && <div className="h-2" />}
        {jobsItems.map(renderItem)}

        {/* Office section */}
        {!collapsed && (
          <div className="text-[calc(10px*var(--ui-scale))] uppercase tracking-[0.12em] text-ink-mute font-semibold px-3 pt-4 pb-1.5">
            Office
          </div>
        )}
        {collapsed && <div className="h-3" />}
        {officeItems.map(renderItem)}
      </nav>

      {/* Expand button (when collapsed) */}
      {collapsed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="w-full h-8 rounded-md grid place-items-center text-ink-mute hover:bg-line-2 hover:text-ink mb-1"
              aria-label="Expand sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar</TooltipContent>
        </Tooltip>
      )}

      {/* User pod */}
      <div className="border-t border-line pt-2 mt-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "w-full p-1.5 rounded-md flex items-center gap-2.5 text-left",
                "hover:bg-line-2",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                collapsed && "justify-center",
              )}
              data-testid="button-user-menu"
              aria-label="User menu"
            >
              <div
                className="w-7 h-7 rounded-full grid place-items-center text-white text-[calc(11px*var(--ui-scale))] font-semibold shrink-0 tracking-wide"
                style={{
                  background: "linear-gradient(140deg, var(--brand-navy-2), var(--brand-navy))",
                }}
              >
                {initials}
              </div>
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="text-[calc(12.5px*var(--ui-scale))] font-medium leading-tight text-ink truncate">
                      {fullName}
                    </div>
                    <div
                      className="font-mono text-[calc(10.5px*var(--ui-scale))] text-ink-mute mt-0.5 truncate capitalize"
                      data-testid="text-user-role"
                    >
                      {(user?.role || "").replace(/_/g, " ")}
                    </div>
                  </div>
                  <MoreVertical className="h-3.5 w-3.5 text-ink-mute shrink-0" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{fullName}</p>
                <p className="text-xs leading-none text-ink-mute truncate">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onUserSettingsClick?.()} data-testid="menu-user-settings">
              <Settings className="h-4 w-4" />
              User Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onHealthClick?.()} data-testid="menu-user-health">
              <Activity className="h-4 w-4" />
              System Health
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onFeedbackClick?.()} data-testid="menu-user-feedback">
              <MessageCircleQuestion className="h-4 w-4" />
              Help &amp; Feedback
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => logoutMutation.mutate()}
              data-testid="menu-user-signout"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
