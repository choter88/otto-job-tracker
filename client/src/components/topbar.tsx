import { useQuery } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import NotificationBell from "@/components/notification-bell";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TopbarProps {
  /** Current active tab id — used to derive the crumb label. */
  activeTab: string;
  onHelpClick?: () => void;
}

const TAB_LABELS: Record<string, string> = {
  all: "Worklist",
  important: "Important",
  overdue: "Overdue",
  past: "Past Jobs",
  analytics: "Analytics",
  team: "Team",
  settings: "Settings",
};

interface HealthResponse {
  ok: boolean;
  ts: number;
}

function HealthPill() {
  const { data, isError, isFetching } = useQuery<HealthResponse>({
    queryKey: ["/api/health"],
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 25_000,
  });

  // Derive state: healthy / checking / error
  const state: "healthy" | "checking" | "error" =
    isError ? "error" : isFetching && !data ? "checking" : data?.ok ? "healthy" : "checking";

  const label =
    state === "error" ? "Host unreachable" : state === "checking" ? "Checking…" : "Host healthy";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-2 px-3 py-[5px] rounded-full text-[calc(11.5px*var(--ui-scale))] font-medium whitespace-nowrap",
            // Healthy uses brand-emerald, NOT --accent — "health = green" stays
            // intact even when the app's accent is changed to a non-green hue.
            state === "healthy" && "text-brand-emerald",
            state === "checking" && "bg-warn-bg text-warn",
            state === "error" && "bg-danger-bg text-danger",
          )}
          style={
            state === "healthy"
              ? { background: "rgba(47, 158, 110, 0.10)" }
              : undefined
          }
          data-testid="health-pill"
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              state === "healthy" && "bg-brand-emerald",
              state === "checking" && "bg-warn",
              state === "error" && "bg-danger",
              state === "healthy" && "animate-[ottoPulseDot_2.4s_ease-out_infinite]",
            )}
          />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {state === "healthy" && "Connected to the host. Data is in sync."}
        {state === "checking" && "Checking connection to the host…"}
        {state === "error" && "Can't reach the host. Try reopening the app."}
      </TooltipContent>
    </Tooltip>
  );
}

export default function Topbar({ activeTab, onHelpClick }: TopbarProps) {
  const label = TAB_LABELS[activeTab] || "Otto";

  return (
    <header
      className="bg-panel border-b border-line px-5 h-[52px] flex items-center gap-3 shrink-0"
      data-testid="topbar"
    >
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <span className="font-display text-[calc(15px*var(--ui-scale))] font-semibold text-ink truncate" data-testid="text-topbar-crumb">
          {label}
        </span>
      </div>

      <span className="flex-1" />

      <HealthPill />

      <NotificationBell />

      {onHelpClick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onHelpClick}
              className="w-8 h-8 rounded-md grid place-items-center text-ink-3 hover:bg-line-2 hover:text-ink"
              aria-label="Help &amp; feedback"
              data-testid="button-topbar-help"
            >
              <HelpCircle className="h-[15px] w-[15px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Help &amp; feedback</TooltipContent>
        </Tooltip>
      )}
    </header>
  );
}
