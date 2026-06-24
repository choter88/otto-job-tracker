import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { format } from "date-fns";
import NotificationBell from "@/components/notification-bell";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TopbarProps {
  /** Current active tab id — used to derive the crumb label. */
  activeTab: string;
  onHelpClick?: () => void;
}

const TAB_LABELS: Record<string, string> = {
  today: "Today",
  all: "Worklist",
  // Route id stays "important" for URL stability; only the label flipped
  // when we renamed the action to "starring" across the app.
  important: "Starred",
  overdue: "Overdue",
  past: "Past Jobs",
  orderSheets: "Order Sheets",
  analytics: "Analytics",
  team: "Team",
  settings: "Settings",
};

function HeaderClock() {
  // Live wall clock for the header. Self-contained so only this node re-renders
  // on tick. ponytail: 1s interval, trivial cost; minute granularity is all we show.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right leading-tight" data-testid="header-clock">
      <div className="text-[calc(12.5px*var(--ui-scale))] font-medium text-ink">
        {format(now, "EEEE, MMM d")}
      </div>
      <div className="font-mono text-[calc(11px*var(--ui-scale))] text-ink-mute tabular-nums">
        {format(now, "h:mm a")}
      </div>
    </div>
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

      <HeaderClock />

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
