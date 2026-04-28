import { useEffect } from "react";

/**
 * Asks Electron to set the window's minimum width so the worklist table
 * never gets clipped horizontally.
 *
 * We deliberately do NOT use `tableEl.scrollWidth`. The wrapper has
 * `overflow-hidden`, so when the window is wide the inner table spreads to
 * fill it — making scrollWidth equal to the *current* available width. Using
 * that as the min-width would pin the window at whatever size it happened
 * to be when the hook fired, instead of the table's actual requirement.
 *
 * Instead we sum each <th>'s declared `min-width` from computed styles.
 * That value is stable (it's set in jobs-table.tsx column classNames like
 * `min-w-[180px]`) and reflects the table's true intrinsic minimum,
 * regardless of the current window size. Cells without a declared min-width
 * fall back to a small constant (icon-only columns).
 *
 * Re-runs when columns are added/removed or the sidebar collapses.
 *
 * Falls back to a no-op outside the Electron preload bridge so this works
 * in dev / browser previews without crashing.
 */
export function useDynamicWindowMinWidth(
  tableEl: HTMLElement | null,
  sidebarEl: HTMLElement | null,
) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const otto = (window as any).otto;
    if (!otto?.setWindowMinWidth) return; // browser preview — skip
    if (!tableEl) return;

    let lastSent = 0;
    let scheduled: number | null = null;

    const compute = () => {
      // Sum of column min-widths drives the table's true intrinsic width.
      // We read it from <th> computed styles rather than scrollWidth so the
      // value doesn't fluctuate with the current window size.
      const tableElement = tableEl.querySelector("table");
      let intrinsicTableWidth = 0;

      if (tableElement) {
        const headerCells = tableElement.querySelectorAll("thead th");
        headerCells.forEach((th) => {
          const cs = window.getComputedStyle(th as HTMLElement);
          const declaredMin = parseFloat(cs.minWidth);
          // Cells without a declared min-width (star, actions) need a small
          // baseline so the sum still reflects their footprint.
          intrinsicTableWidth += !isNaN(declaredMin) && declaredMin > 0 ? declaredMin : 50;
        });
      }

      // Safety net: if header measurement failed entirely (e.g. table not
      // mounted yet), fall back to the wrapper's scrollWidth so we still
      // produce *some* sane value rather than 0.
      const tableWidth = intrinsicTableWidth || tableEl.scrollWidth || 0;
      if (tableWidth <= 0) return;

      const sidebarWidth = sidebarEl?.offsetWidth ?? 224;
      // Outer chrome: <main> wraps with m-3.5 ml-1 + 2px borders, plus a
      // small slack so the user never sees a horizontal scrollbar even
      // mid-resize.
      const chrome = 64;
      const requested = Math.ceil(tableWidth + sidebarWidth + chrome);

      // Don't thrash IPC — only send when the value moves by ≥8px.
      if (Math.abs(requested - lastSent) < 8) return;
      lastSent = requested;
      otto.setWindowMinWidth(requested).catch(() => {
        // Silent fail — desktop main returns { ok:false } during teardown.
      });
    };

    const schedule = () => {
      if (scheduled !== null) return;
      scheduled = window.requestAnimationFrame(() => {
        scheduled = null;
        compute();
      });
    };

    schedule();

    // ResizeObserver catches column add/remove (custom columns) and
    // sidebar collapse. Window resize handles display changes.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(tableEl);
    if (sidebarEl) observer?.observe(sidebarEl);
    window.addEventListener("resize", schedule);

    return () => {
      if (scheduled !== null) window.cancelAnimationFrame(scheduled);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [tableEl, sidebarEl]);
}
