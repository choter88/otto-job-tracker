import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeadProps {
  /** The page title is intentionally NOT rendered here by default — the
   *  topbar crumb already shows the page name. Pass `title` only on pages
   *  where the topbar is hidden or you explicitly want a duplicated title.
   */
  title?: string;
  /** Sub-line content (counts, status hints, etc.). */
  sub?: ReactNode;
  /** Right-side action buttons. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Reusable page sub-header. Renders the sub-line counts + actions row.
 * Title is suppressed by default to avoid duplicating the topbar crumb —
 * pass `title` only when needed.
 */
export default function PageHead({ title, sub, actions, className }: PageHeadProps) {
  // If neither sub nor actions, nothing to render — let the page breathe.
  if (!title && !sub && !actions) return null;

  return (
    <div
      className={cn(
        "flex items-end justify-between gap-4 mb-5 flex-wrap",
        className,
      )}
      data-testid="page-head"
    >
      <div className="min-w-0">
        {title ? (
          <h1 className="font-display text-[calc(30px*var(--ui-scale))] font-medium leading-[1.05] tracking-[-0.03em] text-ink m-0">
            {title}
          </h1>
        ) : null}
        {sub ? (
          <div className={cn(
            "text-ink-mute text-[calc(13px*var(--ui-scale))] tabular-nums flex items-center gap-2 flex-wrap tracking-[-0.005em]",
            title && "mt-2",
          )}>
            {sub}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Small inline dot separator for the sub line. */
export function SubDot() {
  return <span className="text-ink-faint">·</span>;
}

/** Sub-line accent text variants. */
export function SubAccent({ children }: { children: ReactNode }) {
  return <span className="text-otto-accent-ink font-medium">{children}</span>;
}
export function SubDanger({ children }: { children: ReactNode }) {
  return <span className="text-danger font-medium">{children}</span>;
}
export function SubSuccess({ children }: { children: ReactNode }) {
  return <span className="text-otto-accent-ink font-medium">{children}</span>;
}
